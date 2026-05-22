import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Backed.vc (London-based seed VC) portfolio at https://backed.vc/portfolio.
//
// Two-pass:
//   Pass 1 — fetch /portfolio. Static HTML has all 91 /portfolio/<slug>
//            detail-page hrefs, no JS needed.
//   Pass 2 — fetch each /portfolio/<slug>. Each has an inline external URL
//            (first non-noise anchor) plus the company name as page title.

const LISTING_URL = "https://backed.vc/portfolio";
const BASE = "https://backed.vc";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)backed\.vc$/i,
  /(?:^|\.)googletagmanager\.com$/i,
  /(?:^|\.)googleapis\.com$/i,
  /(?:^|\.)gstatic\.com$/i,
  /(?:^|\.)cdn\.prod\.website-files\.com$/i,
  /(?:^|\.)cdn\.jsdelivr\.net$/i,
  /(?:^|\.)fundrbird\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)tiktok\.com$/i,
  /(?:^|\.)crunchbase\.com$/i,
  /(?:^|\.)cookielaw\.org$/i,
  /(?:^|\.)onetrust\.com$/i,
  /(?:^|\.)schema\.org$/i,
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

interface CliArgs { limit: number | null; concurrency: number }

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
  return slug.split("-").map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
}

async function fetchSlugs(): Promise<string[]> {
  const { data: html } = await axios.get<string>(LISTING_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
    maxRedirects: 5,
  });
  const slugs = new Set<string>();
  for (const m of html.matchAll(/href="\/portfolio\/([a-z0-9-]+)"/g)) {
    slugs.add(m[1]);
  }
  return [...slugs];
}

interface Detail { slug: string; name: string; website: string | null }

async function fetchDetail(slug: string): Promise<Detail> {
  const url = `${BASE}/portfolio/${slug}`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    let name = slugToTitle(slug);
    const t = $("title").text();
    if (t) {
      const before = t.split(/\s+[|\-–]\s+/)[0].trim();
      if (before && before.length > 1 && before.length < 80) name = before;
    }
    let website: string | null = null;
    $("a[href^=http]").each((_, a) => {
      const href = ($(a).attr("href") ?? "").trim();
      if (!href || !isCompanyUrl(href)) return;
      website = href;
      return false;
    });
    return { slug, name, website };
  } catch {
    return { slug, name: slugToTitle(slug), website: null };
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
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

export const backedAdapter: IngestorAdapter = {
  name: "Backed",
  source: "backed",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { limit, concurrency } = parseArgs();
    const slugs = await fetchSlugs();
    const work = limit ? slugs.slice(0, limit) : slugs;
    console.log(`[Backed] ${slugs.length} slugs; resolving ${work.length} at concurrency ${concurrency}`);

    let progressDone = 0;
    const startedAt = Date.now();
    const results = await mapConcurrent(work, concurrency, async (slug) => {
      const r = await fetchDetail(slug);
      progressDone++;
      if (progressDone % 20 === 0 || progressDone === work.length) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[Backed] resolved ${progressDone}/${work.length} (${elapsed}s)`);
      }
      return r;
    });

    const out: CompanyRecord[] = [];
    let noWebsite = 0;
    for (const r of results) {
      if (!r.website) { noWebsite++; continue; }
      out.push({
        name: r.name,
        website: r.website,
        sourceId: r.slug,
        investors: ["backed"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    console.log(`[Backed] fetchAndParse DONE: ${out.length} kept — ${noWebsite} no-website`);
    return out;
  },
};

export async function ingestBacked(): Promise<void> {
  await runIngestor(backedAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestBacked().finally(() => prisma.$disconnect()).catch(console.error);
}
