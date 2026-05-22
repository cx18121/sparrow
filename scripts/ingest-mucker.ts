import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { withBrowser, renderPage } from "./_lib/playwright-scrape.js";
import type { Browser } from "playwright";

// Mucker Capital portfolio at https://muckercapital.com/companies.
//
// Two-pass scrape:
//   Pass 1 — Plain HTTP fetch of /companies. WordPress + Elementor renders
//            all ~85 company URLs in the static HTML as anchors to
//            https://mucker.com/company/<slug>/ detail pages. No JS needed.
//   Pass 2 — Playwright each detail page to extract the company's external
//            URL (the "Visit Website" CTA, hydrated via JS).
//
// Note: the listing also exposes the company-category-featured-company
// taxonomy and `industry-<slug>` / `region-<slug>` post-class taxonomies,
// but neither is consistently populated; we ignore them and let buildTags
// route post-ingest from name/website only.

const LISTING_URL = "https://muckercapital.com/companies";
const COMPANY_PREFIX = "https://mucker.com/company/";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)mucker\.com$/i,
  /(?:^|\.)muckercapital\.com$/i,
  /(?:^|\.)gmpg\.org$/i,
  /(?:^|\.)googletagmanager\.com$/i,
  /(?:^|\.)googleapis\.com$/i,
  /(?:^|\.)gstatic\.com$/i,
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
  /(?:^|\.)schema\.org$/i,
  /(?:^|\.)w3\.org$/i,
  /(?:^|\.)wordpress\.org$/i,
  /(?:^|\.)wp\.com$/i,
  // Press hosts that appear in "in the news" blocks.
  /(?:^|\.)nytimes\.com$/i,
  /(?:^|\.)wsj\.com$/i,
  /(?:^|\.)techcrunch\.com$/i,
  /(?:^|\.)bloomberg\.com$/i,
  /(?:^|\.)forbes\.com$/i,
  /(?:^|\.)theinformation\.com$/i,
  /(?:^|\.)reuters\.com$/i,
  /(?:^|\.)wired\.com$/i,
  /(?:^|\.)cnbc\.com$/i,
  /(?:^|\.)who13\.com$/i,
  /(?:^|\.)cision\.com$/i,
  /(?:^|\.)prnewswire\.com$/i,
  /(?:^|\.)businesswire\.com$/i,
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

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

async function fetchSlugs(): Promise<string[]> {
  console.log(`[Mucker] GET ${LISTING_URL}`);
  const { data: html } = await axios.get<string>(LISTING_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
    maxRedirects: 5,
  });
  const slugs = new Set<string>();
  for (const m of html.matchAll(/https:\/\/mucker\.com\/company\/([a-z0-9-]+)\//g)) {
    slugs.add(m[1]);
  }
  return [...slugs];
}

async function scrapeDetail(browser: Browser, slug: string): Promise<{ website: string | null; name: string }> {
  const url = `${COMPANY_PREFIX}${slug}/`;
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

    // Mucker puts the company display name in the page <title> as
    // "<Name> - Mucker Capital". Fall back to slug if missing.
    const titleText = $("title").text();
    let name = slugToTitle(slug);
    if (titleText) {
      const beforeDash = titleText.split(/\s+-\s+/)[0].trim();
      if (beforeDash && beforeDash.length > 1) name = beforeDash;
    }
    return { website, name };
  } catch {
    return { website: null, name: slugToTitle(slug) };
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

export const muckerAdapter: IngestorAdapter = {
  name: "Mucker",
  source: "mucker",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { limit, concurrency } = parseArgs();

    const slugs = await fetchSlugs();
    console.log(`[Mucker] ${slugs.length} slugs in static HTML`);
    const work = limit ? slugs.slice(0, limit) : slugs;

    let progressDone = 0;
    const startedAt = Date.now();

    const results = await withBrowser(async (browser) => {
      return mapConcurrent(work, concurrency, async (slug) => {
        const r = await scrapeDetail(browser, slug);
        progressDone++;
        if (progressDone % 20 === 0 || progressDone === work.length) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          const rate = (progressDone / ((Date.now() - startedAt) / 1000)).toFixed(2);
          console.log(`[Mucker] resolved ${progressDone}/${work.length} (${elapsed}s, ${rate}/s)`);
        }
        return { slug, ...r };
      });
    });

    const out: CompanyRecord[] = [];
    let noWebsite = 0;
    for (const r of results) {
      if (!r.website) {
        noWebsite++;
        continue;
      }
      out.push({
        name: r.name,
        website: r.website,
        sourceId: r.slug,
        investors: ["mucker"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    console.log(`[Mucker] fetchAndParse DONE: ${out.length} kept — ${noWebsite} no-website`);
    return out;
  },
};

export async function ingestMucker(): Promise<void> {
  await runIngestor(muckerAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestMucker().finally(() => prisma.$disconnect()).catch(console.error);
}
