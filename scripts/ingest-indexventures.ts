import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Index Ventures portfolio at https://www.indexventures.com/companies/.
// European growth-stage. Static gunicorn-served HTML with all 372 cards in
// a single page (no JS execution required for the list).
//
// Per list-item markup:
//
//   <li class="companies__relationships__list__item js-company"
//       data-regions='[...]' data-sectors='[...]'>
//     <a href="/companies/<slug>/" class="companies__relationships__list__item__link">
//       <company-name>
//       <!-- optional, when IPO'd: -->
//       <span class="ticker-symbol">NASDAQ: DIBS</span>
//     </a>
//   </li>
//
// Exit filter: a `<span class="ticker-symbol">` inside the anchor is the
// authoritative IPO marker — survey count 75 of 372. Acquired companies
// are NOT flagged distinctly on the list page; they ingest as active.
// Cross-source dedupe will absorb known acquisitions if other sources
// flagged them.
//
// Per detail page (`/companies/<slug>/`):
//   - website = first non-chrome external href. Index's own founders'
//     community site `notoptional.eu` shows up on every detail page and
//     must be excluded.
//
// Some active-listed slugs 404 on detail fetch (stale internal anchors);
// those are counted as no-website.
//
// No stage data on either surface, so every row ingests with stage=null.

const LIST_URL = "https://www.indexventures.com/companies/";
const DETAIL_BASE = "https://www.indexventures.com/companies/";
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CHROME_HOST_PATTERNS: RegExp[] = [
  /\bindexventures\.com$/i,
  /\bnotoptional\.eu$/i,
  /\bgmpg\.org$/i,
  /\bfonts\.(googleapis|gstatic)\.com$/i,
  /\bgoogletagmanager\.com$/i,
  /\bcookielaw\.org$/i,
  /\b(twitter|x|linkedin|facebook|youtube|instagram|tiktok)\.com$/i,
  /\bcdn\./i,
  /\bcloudfront\.net$/i,
  /\bjsdelivr\.net$/i,
  /\bvimeo\.com$/i,
];

function isChromeHost(host: string): boolean {
  return CHROME_HOST_PATTERNS.some((p) => p.test(host));
}

interface ListItem {
  slug: string;
  name: string;
}

async function fetchListItems(): Promise<{ items: ListItem[]; ipoSkipped: number }> {
  console.log(`[Index] GET ${LIST_URL}`);
  const { data: html } = await axios.get<string>(LIST_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  let ipoSkipped = 0;

  $("li.companies__relationships__list__item").each((_, el) => {
    const $li = $(el);
    // IPO exit: presence of <span class="ticker-symbol">
    if ($li.find("span.ticker-symbol").length > 0) {
      ipoSkipped++;
      return;
    }
    const $a = $li.find("a.companies__relationships__list__item__link").first();
    const href = $a.attr("href") ?? "";
    let slug: string | null = null;
    try {
      const u = new URL(href, LIST_URL);
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs[0] !== "companies" || !segs[1] || segs.length > 2) return;
      slug = segs[1];
    } catch {
      return;
    }
    // Name = anchor text minus any nested ticker span text. (ticker handled
    // by the early return above, but be defensive in case markup drifts.)
    const $aClone = $a.clone();
    $aClone.find("span.ticker-symbol").remove();
    const name = $aClone.text().replace(/\s+/g, " ").trim();
    if (!name || !slug) return;
    items.push({ slug, name });
  });

  return { items, ipoSkipped };
}

async function fetchDetailWebsite(slug: string): Promise<string | null> {
  const url = `${DETAIL_BASE}${slug}/`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
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
    return website;
  } catch (err: any) {
    if (err?.response?.status !== 404) {
      console.warn(`[Index] detail fetch failed for ${slug}: ${err.message}`);
    }
    return null;
  }
}

export const indexVenturesAdapter: IngestorAdapter = {
  name: "IndexVentures",
  source: "index-ventures",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { items, ipoSkipped } = await fetchListItems();
    console.log(`[Index] ${items.length} active + ${ipoSkipped} IPO-skipped from list`);

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
            investors: ["index-ventures"],
            signals: ["vc-backed"],
            isVerified: true,
          });
        }
        processed++;
        if (processed % 50 === 0 || processed === items.length) {
          console.log(
            `[Index] details: ${processed}/${items.length} done, ${out.length} kept, ${missingWebsite} no-website`
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
      `[Index] fetchAndParse DONE: ${out.length} kept, ${ipoSkipped} IPO exits, ${missingWebsite} no-website`
    );
    return out;
  },
};

export async function ingestIndexVentures(): Promise<void> {
  await runIngestor(indexVenturesAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestIndexVentures().finally(() => prisma.$disconnect()).catch(console.error);
}
