import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// General Catalyst portfolio at https://www.generalcatalyst.com/portfolio.
// The /portfolio listing is a Webflow carousel that hides the full corpus;
// the 2026-05-11 survey probe found all 578 detail pages enumerated in
// sitemap.xml as `/companies/<slug>`. This reverses the prior Tier-2
// dismissal (Part 4 of this doc) — no Playwright required.
//
// Two-step extraction (mirrors IVP/Insight pattern):
//   1. Fetch sitemap.xml, harvest /companies/<slug> entries.
//   2. For each slug, fetch the detail page and pull:
//        - name    = <h1 class="c-page-header__heading u-text-display ...">
//        - website = first external href that isn't part of GC's own chrome
//                    (intellimize* tracking, greenhouse.io careers, GC's own
//                    CDN, fonts/Google services, social icons).
//
// General Catalyst's detail pages expose NO status field — the site is
// growth-stage focused but mixes active and exited companies without
// surfacing the distinction. Cross-source dedupe in runIngestor will absorb
// most overlap with sources that DO mark exits (a16z, IVP, Coatue,
// Sapphire, Spark). No skiplist for now; revisit if exit noise materially
// hurts a campaign.
//
// No stage data on either surface, so every row ingests with stage=null —
// same shape as Khosla/IVP/Insight/Wave/Sapphire/ICONIQ/Initialized/Costanoa.

const SITEMAP_URL = "https://www.generalcatalyst.com/sitemap.xml";
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Hosts that always belong to GC's chrome / 3rd-party services rather than
// the portfolio company's own URL.
const CHROME_HOST_PATTERNS: RegExp[] = [
  /\bgeneralcatalyst\.com$/i,
  /\bintellimize(io)?\.(co|com|net)$/i,
  /\bgreenhouse\.io$/i,
  /\bcdn\.prod\.website-files\.com$/i,
  /\bfonts\.(googleapis|gstatic)\.com$/i,
  /\bgoogletagmanager\.com$/i,
  /\bcookielaw\.org$/i,
  /\b(twitter|x|linkedin|facebook|youtube|instagram|tiktok)\.com$/i,
  /\bjsdelivr\.net$/i,
  /\bcloudfront\.net$/i,
];

function isChromeHost(host: string): boolean {
  return CHROME_HOST_PATTERNS.some((p) => p.test(host));
}

async function fetchSlugs(): Promise<string[]> {
  console.log(`[GeneralCatalyst] GET ${SITEMAP_URL}`);
  const { data: xml } = await axios.get<string>(SITEMAP_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  const slugs = new Set<string>();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try {
      const u = new URL(m[1].trim());
      if (u.hostname !== "www.generalcatalyst.com") continue;
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
  const url = `https://www.generalcatalyst.com/companies/${slug}`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    // Name: page-header h1 is the canonical company name. The footer also
    // has an h1 ("Insights in your inbox") — anchor on the c-page-header
    // class to be specific.
    const name =
      $("h1.c-page-header__heading").first().text().replace(/\s+/g, " ").trim() ||
      null;

    // Website: first non-chrome external link on the page.
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
    console.warn(`[GeneralCatalyst] detail fetch failed for ${slug}: ${err.message}`);
    return { name: null, website: null };
  }
}

export const generalCatalystAdapter: IngestorAdapter = {
  name: "GeneralCatalyst",
  source: "general-catalyst",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const slugs = await fetchSlugs();
    console.log(`[GeneralCatalyst] ${slugs.length} portfolio slugs from sitemap`);

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
            investors: ["general-catalyst"],
            signals: ["vc-backed"],
            isVerified: true,
          });
        }
        processed++;
        if (processed % 50 === 0 || processed === slugs.length) {
          console.log(
            `[GeneralCatalyst] details: ${processed}/${slugs.length} done, ${out.length} kept, ` +
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
      `[GeneralCatalyst] fetchAndParse DONE: ${out.length} kept, ` +
        `${missingName} no-name, ${missingWebsite} no-website`
    );
    return out;
  },
};

export async function ingestGeneralCatalyst(): Promise<void> {
  await runIngestor(generalCatalystAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestGeneralCatalyst().finally(() => prisma.$disconnect()).catch(console.error);
}
