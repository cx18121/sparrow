import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Summit Partners portfolio at https://www.summitpartners.com/portfolio.
// Pure growth-equity firm. The portfolio page is JS-driven, but the
// sitemap.xml exposes all 407 detail pages as `/companies/<slug>` —
// scrape via the IVP/Insight/GeneralCatalyst sitemap+detail pattern, no
// Playwright needed. The 2026-05-11 survey confirmed live structure.
//
// Per detail page:
//   - name    = <h1 class="heading-m">
//   - website = first external href that isn't part of Summit's chrome
//               (their CDN, fonts, social icons, the FIS Cloud Services
//               investor-portal subdomain that links from every page).
//
// Summit's detail pages do NOT expose a status field. The portfolio mixes
// active and exited companies; cross-source dedupe in runIngestor will
// absorb most overlap with sources that DO mark exits. No skiplist for
// now — revisit if campaign noise materializes.
//
// No stage data on either surface, so every row ingests with stage=null —
// same shape as the other detail-page-hop adapters.

const SITEMAP_URL = "https://www.summitpartners.com/sitemap.xml";
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Hosts that always belong to Summit's chrome / 3rd-party services rather
// than the portfolio company's own URL.
const CHROME_HOST_PATTERNS: RegExp[] = [
  /\bsummitpartners\.com$/i,
  /\bfiscloudservices\.com$/i,
  /\bvimeo\.com$/i,
  /\bfonts\.(googleapis|gstatic)\.com$/i,
  /\bgoogletagmanager\.com$/i,
  /\bcookielaw\.org$/i,
  /\bhubspot\.com$/i,
  /\bsalesforce\.com$/i,
  /\b(twitter|x|linkedin|facebook|youtube|instagram|tiktok)\.com$/i,
  /\bjsdelivr\.net$/i,
  /\bcloudfront\.net$/i,
];

function isChromeHost(host: string): boolean {
  return CHROME_HOST_PATTERNS.some((p) => p.test(host));
}

async function fetchSlugs(): Promise<string[]> {
  console.log(`[Summit] GET ${SITEMAP_URL}`);
  const { data: xml } = await axios.get<string>(SITEMAP_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  const slugs = new Set<string>();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try {
      const u = new URL(m[1].trim());
      if (u.hostname !== "www.summitpartners.com") continue;
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs[0] !== "companies" || !segs[1] || segs.length > 2) continue;
      slugs.add(segs[1]);
    } catch {
      // skip malformed
    }
  }
  return [...slugs];
}

interface DetailRecord {
  name: string | null;
  website: string | null;
}

async function fetchDetail(slug: string): Promise<DetailRecord> {
  const url = `https://www.summitpartners.com/companies/${slug}`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    const name = $("h1.heading-m").first().text().replace(/\s+/g, " ").trim() || null;

    let website: string | null = null;
    $("a[href^='http']").each((_, el) => {
      if (website) return;
      const href = $(el).attr("href")?.trim();
      if (!href) return;
      let host = "";
      try {
        host = new URL(href).hostname.toLowerCase();
      } catch {
        return;
      }
      if (!host || isChromeHost(host)) return;
      website = href;
    });

    return { name, website };
  } catch (err: any) {
    // 404s on stale sitemap entries are expected; log at warn-level so they
    // don't get lost in the noise.
    if (err?.response?.status !== 404) {
      console.warn(`[Summit] detail fetch failed for ${slug}: ${err.message}`);
    }
    return { name: null, website: null };
  }
}

export const summitAdapter: IngestorAdapter = {
  name: "Summit",
  source: "summit",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const slugs = await fetchSlugs();
    console.log(`[Summit] ${slugs.length} portfolio slugs from sitemap`);

    const out: CompanyRecord[] = [];
    let missingName = 0;
    let missingWebsite = 0;
    let processed = 0;
    const inFlight = new Set<Promise<void>>();

    const launch = (slug: string) => {
      const p = (async () => {
        const { name, website } = await fetchDetail(slug);
        if (!name) missingName++;
        else if (!website) missingWebsite++;
        else {
          out.push({
            name,
            website,
            sourceId: slug,
            investors: ["summit"],
            signals: ["vc-backed"],
            isVerified: true,
          });
        }
        processed++;
        if (processed % 50 === 0 || processed === slugs.length) {
          console.log(
            `[Summit] details: ${processed}/${slugs.length} done, ${out.length} kept, ` +
              `${missingName} no-name, ${missingWebsite} no-website`
          );
        }
      })().finally(() => {
        inFlight.delete(p);
      });
      inFlight.add(p);
    };

    for (const slug of slugs) {
      while (inFlight.size >= DETAIL_CONCURRENCY) {
        await Promise.race(inFlight);
      }
      launch(slug);
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
    await Promise.all(inFlight);

    console.log(
      `[Summit] fetchAndParse DONE: ${out.length} kept, ` +
        `${missingName} no-name, ${missingWebsite} no-website`
    );
    return out;
  },
};

export async function ingestSummit(): Promise<void> {
  await runIngestor(summitAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestSummit().finally(() => prisma.$disconnect()).catch(console.error);
}
