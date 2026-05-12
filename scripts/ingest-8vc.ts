import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// 8VC portfolio at https://www.8vc.com/companies. Webflow + Finsweet CMS
// Filter. The list page enumerates 169 unique `/companies/<slug>` internal
// anchors (303 raw cards before cross-tab deduplication) — list pages
// expose name only (`fs-cmsfilter-field="name"`); detail-page hop is
// required for the company website.
//
// Per detail page, the first `target="_blank"` external href that isn't 8VC's
// LP portal (`8vc.altareturn.com`) or a "related companies" link is the
// canonical company URL. (Detail pages render a "More portfolio companies"
// strip near the footer that leaks adjacent portfolio URLs onto the page —
// the FIRST target="_blank" external is the only safe pick.)
//
// 8VC's detail pages do not expose a status / exit field — the survey
// classifies them as "mixed stage." Cross-source dedupe in runIngestor
// will absorb most overlap with sources that DO mark exits.
//
// No stage data, so every row ingests with stage=null — same as the
// majority of the other adapters.

const LIST_URL = "https://www.8vc.com/companies";
const DETAIL_BASE = "https://www.8vc.com";
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CHROME_HOST_PATTERNS: RegExp[] = [
  /\b8vc\.com$/i,
  /\baltareturn\.com$/i,
  /\bgmpg\.org$/i,
  /\bfonts\.(googleapis|gstatic)\.com$/i,
  /\bgoogletagmanager\.com$/i,
  /\bcookielaw\.org$/i,
  /\bunpkg\.com$/i,
  /\bcdn\./i,
  /\bcloudfront\.net$/i,
  /\bjsdelivr\.net$/i,
  /\bvimeo\.com$/i,
  /\bwebsite-files\.com$/i,
  /\bmedium\.com$/i,
  /\bsubstack\.com$/i,
  /\b(twitter|x|linkedin|facebook|youtube|instagram|tiktok)\.com$/i,
];

function isChromeHost(host: string): boolean {
  return CHROME_HOST_PATTERNS.some((p) => p.test(host));
}

interface ListItem {
  slug: string;
  name: string;
}

async function fetchList(): Promise<ListItem[]> {
  console.log(`[8VC] GET ${LIST_URL}`);
  const { data: html } = await axios.get<string>(LIST_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
    maxRedirects: 5,
  });
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const items: ListItem[] = [];

  // Iterate every CMS item; dedupe by slug because category tabs render
  // every company up to 3 times.
  $("div.w-dyn-item").each((_, el) => {
    const $card = $(el);
    const name = $card.find('[fs-cmsfilter-field="name"]').first().text().trim();
    if (!name) return;
    const href = $card.find("a[href^='/companies/']").first().attr("href") ?? "";
    const slug = href.replace(/^\/+companies\/+/, "").replace(/\/$/, "");
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    items.push({ slug, name });
  });
  return items;
}

async function fetchDetailWebsite(slug: string): Promise<string | null> {
  const url = `${DETAIL_BASE}/companies/${slug}`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    let website: string | null = null;
    // Take the FIRST target="_blank" external — the "More portfolio companies"
    // strip at the bottom of every detail page also has target="_blank" links
    // to adjacent portfolio company URLs, so the first one is the only safe
    // pick. Without target="_blank" the candidate pool widens to the nav and
    // any in-body links.
    $('a[target="_blank"][href^="http"]').each((_, el) => {
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
    return website;
  } catch (err: any) {
    if (err?.response?.status !== 404) {
      console.warn(`[8VC] detail fetch failed for ${slug}: ${err.message}`);
    }
    return null;
  }
}

export const eightVcAdapter: IngestorAdapter = {
  name: "8VC",
  source: "8vc",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const items = await fetchList();
    console.log(`[8VC] ${items.length} unique companies from list`);

    const out: CompanyRecord[] = [];
    let missingWebsite = 0;
    let processed = 0;
    const inFlight = new Set<Promise<void>>();

    const launch = (it: ListItem) => {
      const p = (async () => {
        const website = await fetchDetailWebsite(it.slug);
        if (!website) {
          missingWebsite++;
        } else {
          out.push({
            name: it.name,
            website,
            sourceId: it.slug,
            investors: ["8vc"],
            signals: ["vc-backed"],
            isVerified: true,
          });
        }
        processed++;
        if (processed % 25 === 0 || processed === items.length) {
          console.log(
            `[8VC] details: ${processed}/${items.length} done, ${out.length} kept, ${missingWebsite} no-website`
          );
        }
      })().finally(() => {
        inFlight.delete(p);
      });
      inFlight.add(p);
    };

    for (const it of items) {
      while (inFlight.size >= DETAIL_CONCURRENCY) {
        await Promise.race(inFlight);
      }
      launch(it);
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
    await Promise.all(inFlight);

    console.log(
      `[8VC] fetchAndParse DONE: ${out.length} kept, ${missingWebsite} no-website`
    );
    return out;
  },
};

export async function ingestEightVc(): Promise<void> {
  await runIngestor(eightVcAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestEightVc().finally(() => prisma.$disconnect()).catch(console.error);
}
