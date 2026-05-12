import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// General Atlantic portfolio at https://www.generalatlantic.com/investments/.
// Premier growth-equity firm. WordPress + Yoast with `wp/v2/investment` REST
// endpoint exposed (`X-WP-Total: 398`).
//
// Two-step extraction (mirrors Insight Partners' WP-REST pattern):
//   1. Page through /wp-json/wp/v2/investment?per_page=100&page=N for the
//      398 investments — 4 pages × 100 → returns {id, slug, title.rendered,
//      link} per row.
//   2. Per slug, GET /investment/<slug>/ and pull the explicit website link
//      anchor: `<a class="view-site" href="...">View Site</a>`.
//
// General Atlantic's detail pages do not expose a status field — mixes
// active and exited companies without a source-side discriminator. Cross-
// source dedupe in runIngestor will absorb most overlap with sources that
// DO mark exits.
//
// Note URL shape: WordPress CPT slug is `investment` (singular). REST list
// URLs use `/investment/<slug>/` for the canonical detail page. The
// `/investments/` (plural) URL is only the index page.
//
// No stage data on either surface, so every row ingests with stage=null —
// same shape as the other detail-page-hop adapters.

const LIST_URL = "https://www.generalatlantic.com/wp-json/wp/v2/investment";
const PER_PAGE = 100;
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface InvestmentListItem {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
}

interface PortfolioEntry {
  slug: string;
  name: string;
  link: string;
}

async function fetchListPage(page: number): Promise<InvestmentListItem[]> {
  const { data } = await axios.get<InvestmentListItem[]>(LIST_URL, {
    params: { per_page: PER_PAGE, page, _fields: "id,slug,title,link" },
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  return data;
}

async function fetchAllEntries(): Promise<PortfolioEntry[]> {
  const out: PortfolioEntry[] = [];
  let page = 1;
  while (true) {
    let items: InvestmentListItem[];
    try {
      items = await fetchListPage(page);
    } catch (err: any) {
      if (err?.response?.status === 400) break;
      throw err;
    }
    if (items.length === 0) break;
    for (const it of items) {
      const name = cheerio.load(`<x>${it.title.rendered}</x>`)("x").text().trim();
      if (!name || !it.slug || !it.link) continue;
      out.push({ slug: it.slug, name, link: it.link });
    }
    console.log(`[GA] list page ${page}: +${items.length} (total ${out.length})`);
    if (items.length < PER_PAGE) break;
    page++;
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }
  return out;
}

// Pull the explicit "View Site" anchor off the detail page — the class is
// stable across the portfolio. Fallback: first non-GA-chrome external href.
async function fetchDetailWebsite(link: string): Promise<string | null> {
  try {
    const { data: html } = await axios.get<string>(link, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    const explicit = $("a.view-site[href^='http']").first().attr("href")?.trim();
    if (explicit) return explicit;
    // Fallback: any external link that isn't GA's chrome.
    let fallback: string | null = null;
    $("a[href^='http']").each((_, el) => {
      if (fallback) return;
      const href = $(el).attr("href")?.trim();
      if (!href) return;
      let host = "";
      try {
        host = new URL(href).hostname.toLowerCase();
      } catch {
        return;
      }
      if (
        /\bgeneralatlantic\.com$/i.test(host) ||
        /\bgmpg\.org$/i.test(host) ||
        /\bfonts\.(googleapis|gstatic)\.com$/i.test(host) ||
        /\b(twitter|x|linkedin|facebook|youtube|instagram|tiktok)\.com$/i.test(host) ||
        /\bcdn\./i.test(host) ||
        /\bcookielaw\.org$/i.test(host)
      ) {
        return;
      }
      fallback = href;
    });
    return fallback;
  } catch (err: any) {
    if (err?.response?.status !== 404) {
      console.warn(`[GA] detail fetch failed for ${link}: ${err.message}`);
    }
    return null;
  }
}

export const generalAtlanticAdapter: IngestorAdapter = {
  name: "GeneralAtlantic",
  source: "general-atlantic",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const entries = await fetchAllEntries();
    console.log(`[GA] ${entries.length} investments from REST list`);

    const out: CompanyRecord[] = [];
    let missingWebsite = 0;
    let processed = 0;
    const inFlight = new Set<Promise<void>>();

    const launch = (e: PortfolioEntry) => {
      const p = (async () => {
        const website = await fetchDetailWebsite(e.link);
        if (!website) {
          missingWebsite++;
        } else {
          out.push({
            name: e.name,
            website,
            sourceId: e.slug,
            investors: ["general-atlantic"],
            signals: ["vc-backed"],
            isVerified: true,
          });
        }
        processed++;
        if (processed % 50 === 0 || processed === entries.length) {
          console.log(
            `[GA] details: ${processed}/${entries.length} done, ${out.length} kept, ${missingWebsite} no-website`
          );
        }
      })().finally(() => {
        inFlight.delete(p);
      });
      inFlight.add(p);
    };

    for (const e of entries) {
      while (inFlight.size >= DETAIL_CONCURRENCY) {
        await Promise.race(inFlight);
      }
      launch(e);
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
    await Promise.all(inFlight);

    console.log(`[GA] fetchAndParse DONE: ${out.length} kept, ${missingWebsite} no-website`);
    return out;
  },
};

export async function ingestGeneralAtlantic(): Promise<void> {
  await runIngestor(generalAtlanticAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestGeneralAtlantic().finally(() => prisma.$disconnect()).catch(console.error);
}
