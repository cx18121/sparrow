import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Battery Ventures portfolio. The `/portfolio` page 404s in plain HTTP, but
// `company-sitemap.xml` lists all 341 detail pages at `/company/<slug>/`.
// Battery's WP REST does NOT expose the `company` CPT publicly, so the
// sitemap is the only enumeration path.
//
// Per detail page (`/company/<slug>/`):
//
//   <meta property="og:title" content="<Name> - Battery Ventures" />
//   <div class="comp-detail-row">
//     <div class="comp-det-sub">STATUS</div>
//     <div>Acquired by Warburg Pincus</div>          ← EXIT marker (or absent / "Active")
//   </div>
//   <a href="http://www.aplaceformom.com">...        ← website (first non-chrome external)
//
// Exit filter: the STATUS row's value is the authoritative source-side
// discriminator — "Acquired by ...", "IPO", "Public" → skip; "Active" or
// missing/empty → keep. Battery is one of only a few sources (Sapphire,
// Spark, Insight) that publishes an explicit status field.
//
// Series A–D growth focus per the survey. No stage data on the detail page,
// so every row ingests with stage=null.

const SITEMAP_URL = "https://www.battery.com/company-sitemap.xml";
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CHROME_HOST_PATTERNS: RegExp[] = [
  /\bbattery\.com$/i,
  /\bgmpg\.org$/i,
  /\bfonts\.(googleapis|gstatic)\.com$/i,
  /\bgoogletagmanager\.com$/i,
  /\bcookielaw\.org$/i,
  /\bcdn\./i,
  /\bcloudfront\.net$/i,
  /\bjsdelivr\.net$/i,
  /\bcdnjs\.cloudflare\.com$/i,
  /\bvimeo\.com$/i,
  /\bhubspot\.com$/i,
  /\bwp\.com$/i,
  /\bwebtoffee\.com$/i,
  /\b(twitter|x|linkedin|facebook|youtube|instagram|tiktok)\.com$/i,
  // Browser-vendor "upgrade your browser" links Battery's theme drops on every
  // detail page — appearing BEFORE the actual company link in DOM order, so
  // they'll be picked up by a naive "first external link" rule. The first run
  // (commit 0000000) returned google.com/chrome for 171 of 172 companies
  // because google.com wasn't in this list. Keep this synced with the banner.
  /\bapple\.com$/i,
  /\bmicrosoft\.com$/i,
  /\bmozilla\.org$/i,
  /\bgoogle\.com$/i,
  // Product-review aggregators that occasionally appear in description text.
  /\bg2\.com$/i,
];

function isChromeHost(host: string): boolean {
  return CHROME_HOST_PATTERNS.some((p) => p.test(host));
}

function isExitStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  if (s === "" || s === "active" || s === "current" || s === "private") return false;
  // Anything else — "Acquired by ...", "IPO", "Public", "Merged", etc. — is an exit.
  return true;
}

async function fetchSlugs(): Promise<string[]> {
  console.log(`[Battery] GET ${SITEMAP_URL}`);
  const { data: xml } = await axios.get<string>(SITEMAP_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  const slugs = new Set<string>();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try {
      const u = new URL(m[1].trim());
      if (u.hostname !== "www.battery.com") continue;
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs[0] !== "company" || !segs[1] || segs.length > 2) continue;
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
  status: string | null;
}

async function fetchDetail(slug: string): Promise<DetailRecord> {
  const url = `https://www.battery.com/company/${slug}/`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    // Name: og:title carries "<Name> - Battery Ventures". Strip the suffix.
    const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() ?? "";
    const name = ogTitle.replace(/\s*-\s*Battery Ventures\s*$/i, "").trim() || null;

    // Status row — the STATUS label, then the value-bearing sibling div.
    let status: string | null = null;
    $("div.comp-det-sub").each((_, el) => {
      if (status) return;
      const label = $(el).text().trim().toUpperCase();
      if (label === "STATUS") {
        const $next = $(el).nextAll("div").first();
        const val = $next.text().trim();
        if (val) status = val;
      }
    });

    // Website: first non-chrome external link.
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

    return { name, website, status };
  } catch (err: any) {
    if (err?.response?.status !== 404) {
      console.warn(`[Battery] detail fetch failed for ${slug}: ${err.message}`);
    }
    return { name: null, website: null, status: null };
  }
}

export const batteryAdapter: IngestorAdapter = {
  name: "Battery",
  source: "battery",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const slugs = await fetchSlugs();
    console.log(`[Battery] ${slugs.length} portfolio slugs from sitemap`);

    const out: CompanyRecord[] = [];
    let skippedExit = 0;
    let missingName = 0;
    let missingWebsite = 0;
    let processed = 0;
    const inFlight = new Set<Promise<void>>();

    const launch = (slug: string) => {
      const p = (async () => {
        const { name, website, status } = await fetchDetail(slug);
        if (isExitStatus(status)) {
          skippedExit++;
        } else if (!name) {
          missingName++;
        } else if (!website) {
          missingWebsite++;
        } else {
          out.push({
            name,
            website,
            sourceId: slug,
            investors: ["battery"],
            signals: ["vc-backed"],
            isVerified: true,
          });
        }
        processed++;
        if (processed % 50 === 0 || processed === slugs.length) {
          console.log(
            `[Battery] details: ${processed}/${slugs.length} done, ${out.length} kept, ` +
              `${skippedExit} exits, ${missingName} no-name, ${missingWebsite} no-website`
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
      `[Battery] fetchAndParse DONE: ${out.length} kept, ${skippedExit} exits, ` +
        `${missingName} no-name, ${missingWebsite} no-website`
    );
    return out;
  },
};

export async function ingestBattery(): Promise<void> {
  await runIngestor(batteryAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestBattery().finally(() => prisma.$disconnect()).catch(console.error);
}
