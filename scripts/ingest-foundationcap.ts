import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Foundation Capital portfolio.
//
// foundationcap.com's main /portfolio page is a Framer SPA that only
// renders featured-founder testimonials — not their full portfolio. The
// usable surface is their **Getro-hosted talent network** at
// jobs.foundationcapital.com, which exposes:
//   - sitemap.xml with all 110 /companies/<slug> URLs
//   - per-company detail pages with the external URL rendered server-side
//     ("Visit website" → http://<company>.com)
//
// Plain HTTP works end to end (no JS required). Concurrency 6 keeps the
// fetch within Getro's per-IP threshold without rate-limiting.

const SITEMAP_URL = "https://jobs.foundationcapital.com/sitemap.xml";
const BASE = "https://jobs.foundationcapital.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)foundationcap\.com$/i,
  /(?:^|\.)foundationcapital\.com$/i,
  /(?:^|\.)getro\.com$/i,
  /(?:^|\.)crunchbase\.com$/i,  // Getro shows a Crunchbase link too; skip it
  /(?:^|\.)googletagmanager\.com$/i,
  /(?:^|\.)googleapis\.com$/i,
  /(?:^|\.)gstatic\.com$/i,
  /(?:^|\.)filepicker\.io$/i,
  /(?:^|\.)jsdelivr\.net$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)tiktok\.com$/i,
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

async function fetchSitemapSlugs(): Promise<string[]> {
  console.log(`[FoundationCap] GET ${SITEMAP_URL}`);
  const { data: xml } = await axios.get<string>(SITEMAP_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  const slugs = new Set<string>();
  for (const m of xml.matchAll(/\/companies\/([a-z0-9_-]+)/g)) {
    slugs.add(m[1]);
  }
  return [...slugs];
}

function slugToTitle(slug: string): string {
  // Slugs sometimes carry "-2", "-3", or UUID suffixes for dedupe. Drop both.
  const cleaned = slug
    .replace(/-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/, "")
    .replace(/-\d+$/, "");
  return cleaned
    .split("-")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

interface Detail {
  slug: string;
  name: string;
  website: string | null;
  oneLiner: string | null;
}

async function fetchDetail(slug: string): Promise<Detail> {
  const url = `${BASE}/companies/${slug}`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    // Name from <title> "<Name> - Foundation Capital".
    let name = slugToTitle(slug);
    const t = $("title").text();
    if (t) {
      const before = t.split(/\s+[|\-–]\s+/)[0].trim();
      if (before && before.length > 1 && before.length < 80) name = before;
    }

    // External URL — first non-noise http(s) anchor.
    let website: string | null = null;
    $("a[href^=http]").each((_, a) => {
      const href = ($(a).attr("href") ?? "").trim();
      if (!href || !isCompanyUrl(href)) return;
      website = href;
      return false;
    });

    // One-liner from meta description (Getro renders one for SEO).
    let oneLiner: string | null = null;
    const desc = $('meta[name="description"]').attr("content")?.trim();
    if (desc && desc.length > 5) oneLiner = desc.length > 280 ? desc.slice(0, 277) + "..." : desc;

    return { slug, name, website, oneLiner };
  } catch {
    return { slug, name: slugToTitle(slug), website: null, oneLiner: null };
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

export const foundationCapAdapter: IngestorAdapter = {
  name: "FoundationCap",
  source: "foundationcap",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { limit, concurrency } = parseArgs();
    const slugs = await fetchSitemapSlugs();
    const work = limit ? slugs.slice(0, limit) : slugs;
    console.log(`[FoundationCap] ${slugs.length} slugs; resolving ${work.length} at concurrency ${concurrency}`);

    let progressDone = 0;
    const startedAt = Date.now();

    const results = await mapConcurrent(work, concurrency, async (slug) => {
      const d = await fetchDetail(slug);
      progressDone++;
      if (progressDone % 20 === 0 || progressDone === work.length) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[FoundationCap] resolved ${progressDone}/${work.length} (${elapsed}s)`);
      }
      return d;
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
        oneLiner: r.oneLiner,
        sourceId: r.slug,
        investors: ["foundationcap"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    console.log(`[FoundationCap] fetchAndParse DONE: ${out.length} kept — ${noWebsite} no-website`);
    return out;
  },
};

export async function ingestFoundationCap(): Promise<void> {
  await runIngestor(foundationCapAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestFoundationCap().finally(() => prisma.$disconnect()).catch(console.error);
}
