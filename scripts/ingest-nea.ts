import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { withBrowser, renderPage } from "./_lib/playwright-scrape.js";
import type { Browser } from "playwright";

// NEA portfolio at https://www.nea.com.
//
// Two-pass scrape because NEA's /portfolio surfaces only 30 featured cards.
// Pass 1 — read sitemap.xml for the full set of /portfolio/<slug> URLs (~900
// rows including exits). Pass 2 — Playwright each detail page to recover:
//   - external company URL (rendered into the DOM after hydration)
//   - status text (Active / Acquired / IPO — Acquired/IPO get filtered out)
//   - human-readable company name (h2 / page text — fallback: slug-to-title)
//
// Detail pages are static-HTML-empty for the website link; Playwright is the
// only path. Memory previously noted NEA as a "names-but-no-URLs" dead end —
// that was stale; the URL is in the rendered DOM as of 2026-05-21.
//
// Cost: free (Playwright + bandwidth only). ~30 minutes wall time at
// concurrency 4 for 900 detail pages.
//
// Usage:
//   npx tsx scripts/ingest-nea.ts                # all slugs from sitemap
//   npx tsx scripts/ingest-nea.ts --limit 20     # smoke test
//   npx tsx scripts/ingest-nea.ts --concurrency 6
//
// Status distribution from a 50-row probe (2026-05-21): roughly even
// active / acquired split with a long tail of IPO + acquired-many-years-ago.

const SITEMAP_URL = "https://www.nea.com/sitemap.xml";
const BASE = "https://www.nea.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Hosts that must not be treated as a portfolio company's website. NEA's own
// chrome (instagram/twitter/linkedin/youtube), universal CDN/analytics, and a
// global YouTube link to NEA's channel that appears in every detail page.
const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)nea\.com$/i,
  /(?:^|\.)googletagmanager\.com$/i,
  /(?:^|\.)googleapis\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)tiktok\.com$/i,
  /(?:^|\.)w3\.org$/i,
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
  let concurrency = 4;
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

async function fetchSitemapSlugs(): Promise<string[]> {
  console.log(`[NEA] GET ${SITEMAP_URL}`);
  const { data: xml } = await axios.get<string>(SITEMAP_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  const slugs = new Set<string>();
  for (const m of xml.matchAll(/\/portfolio\/([a-z0-9-]+)/g)) {
    const slug = m[1];
    // /portfolio/page-<hash> are pagination shells, not companies.
    if (slug.startsWith("page-")) continue;
    slugs.add(slug);
  }
  return [...slugs];
}

interface DetailPageResult {
  slug: string;
  name: string | null;
  website: string | null;
  status: string | null;
}

async function scrapeDetailPage(browser: Browser, slug: string): Promise<DetailPageResult> {
  const url = `${BASE}/portfolio/${slug}`;
  try {
    const html = await renderPage(browser, url, {
      waitForTimeout: 8_000,
      navigationTimeout: 20_000,
    });
    const $ = cheerio.load(html);

    // Status: NEA renders bare text "Active" / "Acquired" / "IPO" inside its
    // own block. Match a single-word leaf text node.
    let status: string | null = null;
    $("*").each((_, el) => {
      const text = $(el).clone().children().remove().end().text().trim();
      if (/^(Active|Acquired|IPO|Public|Exited)$/i.test(text)) {
        status = text;
        return false;
      }
    });

    // External company URL. First non-noise http(s) anchor.
    let website: string | null = null;
    $("a[href^=http]").each((_, a) => {
      const href = ($(a).attr("href") ?? "").trim();
      if (!href || !isCompanyUrl(href)) return;
      website = href;
      return false;
    });

    // Name from page title — NEA puts the company display name in <title>
    // as "<Name> | New Enterprise Associates". Fall back to slug-to-title.
    const titleText = $("title").first().text();
    let name: string | null = null;
    if (titleText) {
      const beforePipe = titleText.split("|")[0].trim();
      if (beforePipe && beforePipe.length > 1) name = beforePipe;
    }
    if (!name) name = slugToTitle(slug);

    return { slug, name, website, status };
  } catch (err) {
    console.warn(
      `[NEA] detail-page failure for ${slug}: ${err instanceof Error ? err.message : String(err)}`
    );
    return { slug, name: null, website: null, status: null };
  }
}

// Concurrency-limited mapper — keeps `concurrency` Playwright pages in flight.
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

export const neaAdapter: IngestorAdapter = {
  name: "NEA",
  source: "nea",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { limit, concurrency } = parseArgs();

    const slugs = await fetchSitemapSlugs();
    const work = limit ? slugs.slice(0, limit) : slugs;
    console.log(`[NEA] ${slugs.length} sitemap slugs; processing ${work.length} at concurrency ${concurrency}`);

    let progressDone = 0;
    const startedAt = Date.now();

    const results = await withBrowser(async (browser) => {
      return mapConcurrent(work, concurrency, async (slug) => {
        const r = await scrapeDetailPage(browser, slug);
        progressDone++;
        if (progressDone % 25 === 0 || progressDone === work.length) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          const rate = (progressDone / ((Date.now() - startedAt) / 1000)).toFixed(2);
          console.log(`[NEA] scraped ${progressDone}/${work.length} (${elapsed}s, ${rate}/s)`);
        }
        return r;
      });
    });

    const out: CompanyRecord[] = [];
    let nonActive = 0;
    let noWebsite = 0;
    let noName = 0;

    for (const r of results) {
      if (!r.name) {
        noName++;
        continue;
      }
      // Reject Acquired / IPO / Public / Exited. Keep Active and unknown
      // (some active companies have no status badge rendered).
      if (r.status && /^(acquired|ipo|public|exited)$/i.test(r.status)) {
        nonActive++;
        continue;
      }
      if (!r.website) {
        noWebsite++;
        continue;
      }
      out.push({
        name: r.name,
        website: r.website,
        sourceId: r.slug,
        investors: ["nea"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }

    console.log(
      `[NEA] fetchAndParse DONE: ${out.length} kept — ` +
        `${nonActive} exits, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestNea(): Promise<void> {
  await runIngestor(neaAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestNea().finally(() => prisma.$disconnect()).catch(console.error);
}
