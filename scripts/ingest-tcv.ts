import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// TCV (Technology Crossover Ventures) portfolio.
// Next.js + Contentful; the list at /portfolio is JS-rendered and doesn't
// survive a plain HTTP fetch, but `sitemap-0.xml` enumerates all 150
// `/partnerships/<slug>` detail pages. Bypass the JS shell entirely.
//
// Per detail page (server-rendered HTML carries everything we need):
//
//   <meta property="og:title" content="Corgi | TCV" />          ← name
//   <h2 class="css-bp8zrk">Status</h2>
//   <p class="css-fjs13y">Active</p>                            ← status
//   <a href="https://www.corgi.insure/">...Website...</a>       ← website
//
// Exit filter: the `Status` field is the authoritative source-side
// discriminator. Observed values: "Active" (keep) and a handful of exit
// variants ("Acquired", "Public", "Exited"). Anything that isn't "Active"
// is treated as an exit.
//
// Website extraction: find the anchor whose visible text contains
// "Website" (case-insensitive). Falling back to first-non-chrome-external
// is risky because TCV detail pages link to a Citco LP-portal page and to
// Contentful's image CDN, both of which would otherwise win.
//
// No stage data on the detail page, so every active row ingests with
// stage=null. Pure growth-equity focus, so the lack of stage is fine —
// the firm only does growth.

const SITEMAP_URL = "https://www.tcv.com/sitemap-0.xml";
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchSlugs(): Promise<string[]> {
  console.log(`[TCV] GET ${SITEMAP_URL}`);
  const { data: xml } = await axios.get<string>(SITEMAP_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  const slugs = new Set<string>();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try {
      const u = new URL(m[1].trim());
      if (u.hostname !== "www.tcv.com") continue;
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs[0] !== "partnerships" || !segs[1] || segs.length > 2) continue;
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

function isExitStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  // Anything that isn't explicitly "Active" is treated as exit.
  if (s === "active" || s === "current" || s === "private") return false;
  return s.length > 0;
}

async function fetchDetail(slug: string): Promise<DetailRecord> {
  const url = `https://www.tcv.com/partnerships/${slug}`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    // Name: og:title carries "<Name> | TCV". Strip the suffix.
    const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() ?? "";
    const name = ogTitle.replace(/\s*\|\s*TCV\s*$/i, "").trim() || null;

    // Status field: <h2>Status</h2> followed by <p>VALUE</p>.
    let status: string | null = null;
    $("h2").each((_, el) => {
      if (status) return;
      if ($(el).text().trim().toLowerCase() === "status") {
        const $next = $(el).nextAll("p").first();
        const val = $next.text().trim();
        if (val) status = val;
      }
    });

    // Website: anchor whose visible text contains "Website" (case-insensitive).
    let website: string | null = null;
    $("a[href^='http']").each((_, el) => {
      if (website) return;
      const $a = $(el);
      if (/website/i.test($a.text())) {
        const href = $a.attr("href")?.trim();
        if (href && /^https?:\/\//i.test(href)) website = href;
      }
    });

    return { name, website, status };
  } catch (err: any) {
    if (err?.response?.status !== 404) {
      console.warn(`[TCV] detail fetch failed for ${slug}: ${err.message}`);
    }
    return { name: null, website: null, status: null };
  }
}

export const tcvAdapter: IngestorAdapter = {
  name: "TCV",
  source: "tcv",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const slugs = await fetchSlugs();
    console.log(`[TCV] ${slugs.length} partnership slugs from sitemap`);

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
            investors: ["tcv"],
            signals: ["vc-backed"],
            isVerified: true,
          });
        }
        processed++;
        if (processed % 25 === 0 || processed === slugs.length) {
          console.log(
            `[TCV] details: ${processed}/${slugs.length} done, ${out.length} kept, ` +
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
      `[TCV] fetchAndParse DONE: ${out.length} kept, ${skippedExit} exits, ` +
        `${missingName} no-name, ${missingWebsite} no-website`
    );
    return out;
  },
};

export async function ingestTcv(): Promise<void> {
  await runIngestor(tcvAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestTcv().finally(() => prisma.$disconnect()).catch(console.error);
}
