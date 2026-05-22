import "dotenv/config";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { withBrowser, renderPage } from "./_lib/playwright-scrape.js";
import type { Browser } from "playwright";

// Northzone portfolio at https://www.northzone.com/portfolio.
//
// Two-pass scrape:
//   Pass 1 — Playwright the listing page (Webflow, lazy CMS render).
//            Parse cards: filters5_company-list-item → href, name, status,
//            stage, industry. Drop status != "Active" (15 IPO + 13 Acquired
//            removed at the listing level).
//   Pass 2 — Playwright each /portfolio/<slug> detail page to extract the
//            external company URL (first non-noise external href).
//
// Static HTML only renders 12 visible cards but the full 139-entry CMS
// collection is in the DOM, so a single Playwright render of the listing
// (without scroll) returns the whole set.
//
// Cost: free. Listing render + ~105 detail renders at concurrency 6.

const LISTING_URL = "https://www.northzone.com/portfolio";
const BASE = "https://www.northzone.com";

const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)northzone\.com$/i,
  /(?:^|\.)googletagmanager\.com$/i,
  /(?:^|\.)googleapis\.com$/i,
  /(?:^|\.)gstatic\.com$/i,
  /(?:^|\.)cdn\.prod\.website-files\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)tiktok\.com$/i,
  /(?:^|\.)cookielaw\.org$/i,
  /(?:^|\.)onetrust\.com$/i,
  /(?:^|\.)cookie-script\.com$/i,
  /(?:^|\.)intellimize/i,
  /(?:^|\.)milkywire\.com$/i,
  /(?:^|\.)chatgpt\.com$/i,
  /(?:^|\.)claude\.ai$/i,
  /(?:^|\.)schema\.org$/i,
  /(?:^|\.)w3\.org$/i,
  // Press hosts often appearing in "in the news" lists.
  /(?:^|\.)nytimes\.com$/i,
  /(?:^|\.)wsj\.com$/i,
  /(?:^|\.)techcrunch\.com$/i,
  /(?:^|\.)bloomberg\.com$/i,
  /(?:^|\.)forbes\.com$/i,
  /(?:^|\.)theinformation\.com$/i,
  /(?:^|\.)reuters\.com$/i,
  /(?:^|\.)wired\.com$/i,
  /(?:^|\.)cnbc\.com$/i,
  /(?:^|\.)ft\.com$/i,
  /(?:^|\.)businesschief\.com$/i,
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
  status: string;
  stage: string | null;
  industry: string | null;
}

function parseListing(html: string): ListingCard[] {
  const $ = cheerio.load(html);
  const cards: ListingCard[] = [];
  $(".filters5_company-list-item").each((_, el) => {
    const $card = $(el);

    const $link = $card.find("a.filters5_company-link").first();
    const href = ($link.attr("href") ?? "").trim();
    const m = href.match(/^\/portfolio\/([a-z0-9-]+)$/);
    if (!m) return;
    const slug = m[1];

    const name = $link.find(".heading-style-h1-variant").first().text().trim()
      || $link.text().trim();
    if (!name) return;

    let status = "";
    let stage: string | null = null;
    let industry: string | null = null;
    $card.find('[fs-cmsfilter-field]').each((_, n) => {
      const field = $(n).attr("fs-cmsfilter-field");
      const val = $(n).text().trim();
      if (!val) return;
      if (field === "status" && !status) status = val;
      else if (field === "stage" && !stage) stage = val;
      else if (field === "industry" && !industry) industry = val;
    });

    cards.push({ slug, name, status, stage, industry });
  });
  return cards;
}

async function scrapeWebsiteFromDetail(browser: Browser, slug: string): Promise<string | null> {
  const url = `${BASE}/portfolio/${slug}`;
  try {
    const html = await renderPage(browser, url, {
      waitForTimeout: 8_000,
      navigationTimeout: 20_000,
    });
    const $ = cheerio.load(html);
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

function mapStage(s: string | null): string | null {
  if (!s) return null;
  // Northzone uses Seed / Series A / Series B / Series C etc. labels — pass
  // through; downstream stage normalization is in `expandStageFilter`.
  return s.trim();
}

export const northzoneAdapter: IngestorAdapter = {
  name: "Northzone",
  source: "northzone",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { limit, concurrency } = parseArgs();

    console.log(`[Northzone] Playwright ${LISTING_URL}`);
    const html = await withBrowser(async (browser) => {
      return renderPage(browser, LISTING_URL, { waitForTimeout: 15_000 });
    });
    const cards = parseListing(html);
    console.log(`[Northzone] listing yielded ${cards.length} cards`);
    const active = cards.filter((c) => c.status === "Active");
    console.log(`[Northzone] Active: ${active.length}, IPO/Acquired filtered: ${cards.length - active.length}`);

    const work = limit ? active.slice(0, limit) : active;

    let progressDone = 0;
    const startedAt = Date.now();

    const websites = await withBrowser(async (browser) => {
      return mapConcurrent(work, concurrency, async (card) => {
        const w = await scrapeWebsiteFromDetail(browser, card.slug);
        progressDone++;
        if (progressDone % 25 === 0 || progressDone === work.length) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          const rate = (progressDone / ((Date.now() - startedAt) / 1000)).toFixed(2);
          console.log(`[Northzone] resolved ${progressDone}/${work.length} (${elapsed}s, ${rate}/s)`);
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
        industry: card.industry,
        stage: mapStage(card.stage),
        sourceId: card.slug,
        investors: ["northzone"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    console.log(`[Northzone] fetchAndParse DONE: ${out.length} kept — ${noWebsite} no-website`);
    return out;
  },
};

export async function ingestNorthzone(): Promise<void> {
  await runIngestor(northzoneAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestNorthzone().finally(() => prisma.$disconnect()).catch(console.error);
}
