import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { withBrowser, renderPage } from "./_lib/playwright-scrape.js";
import type { Browser } from "playwright";

// DCVC portfolio at https://www.dcvc.com/companies/.
//
// Listing page renders all 292 cards inline with rich attributes:
//   - data-status="all,current" | "all,exits"     → status filter
//   - data-sector="all,<slug>"                    → sector
//   - <a href="/companies/<slug>">                → detail-page URL
//   - <span class="highlight__target">            → display name
//   - <p class="company-card__desc">              → one-liner
// 222 current cards, 70 exits. We filter exits at the listing.
//
// External company URL is NOT on the listing — it's hydrated into the
// detail page via Alpine.js. Pass 2 Playwrights each detail page to find
// the first non-noise external <a href>.
//
// Cost: free (no API spend). ~2 min for 222 detail pages at concurrency 6.

const LISTING_URL = "https://www.dcvc.com/companies/";
const BASE = "https://www.dcvc.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)dcvc\.com$/i,
  /(?:^|\.)googletagmanager\.com$/i,
  /(?:^|\.)googleapis\.com$/i,
  /(?:^|\.)gstatic\.com$/i,
  /(?:^|\.)netlify\.com$/i,
  /(?:^|\.)cookie-script\.com$/i,
  /(?:^|\.)cookielaw\.org$/i,
  /(?:^|\.)policies\.google\.com$/i,
  /(?:^|\.)safety\.google$/i,
  /(?:^|\.)business\.safety\.google$/i,
  /(?:^|\.)schema\.org$/i,
  /(?:^|\.)w3\.org$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)tiktok\.com$/i,
  /(?:^|\.)onedesigncompany\.com$/i,
  /(?:^|\.)sentry\.io$/i,
  // News / press hosts that often appear before the company link in DCVC's
  // detail-page DOM (the "in the news" section).
  /(?:^|\.)wsj\.com$/i,
  /(?:^|\.)nytimes\.com$/i,
  /(?:^|\.)techcrunch\.com$/i,
  /(?:^|\.)theinformation\.com$/i,
  /(?:^|\.)newyorker\.com$/i,
  /(?:^|\.)cnbc\.com$/i,
  /(?:^|\.)fiercebiotech\.com$/i,
  /(?:^|\.)time\.com$/i,
  /(?:^|\.)forbes\.com$/i,
  /(?:^|\.)bloomberg\.com$/i,
  /(?:^|\.)reuters\.com$/i,
  /(?:^|\.)wired\.com$/i,
];

function isCompanyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !NON_COMPANY_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

interface CliArgs {
  limit: number | null;
  concurrency: number;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let limit: number | null = null;
  let concurrency = 6;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") limit = parseInt(argv[++i], 10);
    else if (a === "--concurrency") concurrency = parseInt(argv[++i], 10);
  }
  return { limit, concurrency };
}

interface ListingCard {
  slug: string;
  name: string;
  desc: string | null;
  sector: string | null;
}

async function fetchListingCards(): Promise<ListingCard[]> {
  console.log(`[DCVC] GET ${LISTING_URL}`);
  const { data: html } = await axios.get<string>(LISTING_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
    maxRedirects: 5,
  });
  const $ = cheerio.load(html);
  const cards: ListingCard[] = [];

  $("article.company-card").each((_, el) => {
    const $card = $(el);
    const status = $card.attr("data-status") ?? "";
    if (!status.includes("current")) return;

    const href = $card.find("a.company-card__figure-link").attr("href") ?? "";
    const slugMatch = href.match(/\/companies\/([a-z0-9-]+)/);
    if (!slugMatch) return;
    const slug = slugMatch[1];

    const name = $card.find(".highlight__target").first().text().trim()
      || $card.find(".company-card__headline").first().text().trim();
    if (!name) return;

    const desc = $card.find(".company-card__desc").first().text().trim() || null;
    const sectorAttr = $card.attr("data-sector") ?? "";
    const sectorMatch = sectorAttr.match(/all,([a-z-]+)/);
    const sector = sectorMatch ? sectorMatch[1].replace(/-/g, " ") : null;

    cards.push({ slug, name, desc, sector });
  });

  return cards;
}

async function scrapeWebsiteFromDetail(browser: Browser, slug: string): Promise<string | null> {
  const url = `${BASE}/companies/${slug}/`;
  try {
    const html = await renderPage(browser, url, {
      waitForTimeout: 8_000,
      navigationTimeout: 20_000,
    });
    const $ = cheerio.load(html);

    // The detail page surfaces a "Visit website" CTA + an "In the news"
    // press list. The CTA appears first in document order, but the news
    // list also contains external hrefs. We filter known news hosts via
    // NON_COMPANY_HOST_PATTERNS so the first non-noise href is the company.
    let website: string | null = null;
    $("a[href^=http]").each((_, a) => {
      const href = ($(a).attr("href") ?? "").trim();
      if (!href || !isCompanyUrl(href)) return;
      website = href;
      return false;
    });
    return website;
  } catch {
    return null;
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// DCVC's sector slugs map onto our industry / vertical-ish vocabulary loosely;
// keep them as free-form industry text and let `buildTags` route what it can.
function sectorToIndustry(sector: string | null): string | null {
  if (!sector) return null;
  return sector;
}

export const dcvcAdapter: IngestorAdapter = {
  name: "DCVC",
  source: "dcvc",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { limit, concurrency } = parseArgs();

    const cards = await fetchListingCards();
    const work = limit ? cards.slice(0, limit) : cards;
    console.log(`[DCVC] ${cards.length} current cards; resolving URLs for ${work.length} at concurrency ${concurrency}`);

    let progressDone = 0;
    const startedAt = Date.now();

    const websites = await withBrowser(async (browser) => {
      return mapConcurrent(work, concurrency, async (card) => {
        const w = await scrapeWebsiteFromDetail(browser, card.slug);
        progressDone++;
        if (progressDone % 25 === 0 || progressDone === work.length) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          const rate = (progressDone / ((Date.now() - startedAt) / 1000)).toFixed(2);
          console.log(`[DCVC] resolved ${progressDone}/${work.length} (${elapsed}s, ${rate}/s)`);
        }
        return w;
      });
    });

    const out: CompanyRecord[] = [];
    let noWebsite = 0;

    for (let i = 0; i < work.length; i++) {
      const card = work[i];
      const website = websites[i];
      if (!website) {
        noWebsite++;
        continue;
      }
      out.push({
        name: card.name,
        website,
        oneLiner: card.desc,
        industry: sectorToIndustry(card.sector),
        sourceId: card.slug,
        investors: ["dcvc"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }

    console.log(
      `[DCVC] fetchAndParse DONE: ${out.length} kept — ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestDcvc(): Promise<void> {
  await runIngestor(dcvcAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestDcvc().finally(() => prisma.$disconnect()).catch(console.error);
}
