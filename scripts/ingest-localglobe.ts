import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// LocalGlobe / Phoenix Court portfolio at https://www.phoenixcourt.vc.
//
// Phoenix Court is the umbrella firm; LocalGlobe (seed) is the flagship
// fund. The portfolio is exposed via a JSON API:
//   /api/v1/listings/companies?funds=<fund>&page=<n>
// Funds: localglobe (240), latitude (74), solar (10), basecamp (0),
// phoenix-court-works (0). 268 unique across all funds (some overlap).
//
// API yields slug + name + standfirst + companyStatus. The external URL
// lives on the detail page /companies/<slug> as an inline anchor — plain
// HTTP, no JS.
//
// Statuses observed: "Live", "Publicly listed", and likely "Acquired" on
// some rows. We drop "Acquired" + "Defunct" + "Closed"; keep Live + IPO.

const BASE = "https://www.phoenixcourt.vc";
const LISTING_API = `${BASE}/api/v1/listings/companies`;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)phoenixcourt\.vc$/i,
  /(?:^|\.)localglobe\.vc$/i,
  /(?:^|\.)latitude\.vc$/i,
  /(?:^|\.)consider\.com$/i,
  /(?:^|\.)googletagmanager\.com$/i,
  /(?:^|\.)googleapis\.com$/i,
  /(?:^|\.)gstatic\.com$/i,
  /(?:^|\.)cdn\.prod\.website-files\.com$/i,
  /(?:^|\.)admin\.phoenixcourt\.vc$/i,
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

interface CliArgs { limit: number | null; concurrency: number }

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let limit: number | null = null;
  let concurrency = 8;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") limit = parseInt(argv[++i], 10);
    else if (a === "--concurrency") concurrency = parseInt(argv[++i], 10);
  }
  return { limit, concurrency };
}

interface ApiItem {
  slug: string;
  name: string;
  standfirst: string | null;
  status: string;
}

async function fetchAllListings(): Promise<ApiItem[]> {
  const all = new Map<string, ApiItem>();
  const funds = "funds=localglobe&funds=latitude&funds=solar&funds=basecamp&funds=phoenix-court-works";
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const url = `${LISTING_API}?${funds}&page=${page}`;
    const { data } = await axios.get<{ items: Array<{ node: any }>; totalItems: number; totalPages: number }>(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      timeout: 30_000,
    });
    totalPages = data.totalPages;
    for (const it of data.items ?? []) {
      const n = it.node;
      const internalUrl: string = n?.url ?? "";
      const m = internalUrl.match(/\/companies\/([a-z0-9-]+)/);
      if (!m) continue;
      const slug = m[1];
      const name = (n?.title ?? "").trim();
      if (!name) continue;
      if (all.has(slug)) continue;
      all.set(slug, {
        slug,
        name,
        standfirst: (n?.standfirst ?? "").trim() || null,
        status: (n?.companyStatus ?? "").trim(),
      });
    }
    console.log(`[LocalGlobe] api page ${page}/${totalPages} → cumulative ${all.size}`);
    page++;
  }
  return [...all.values()];
}

interface Detail { slug: string; website: string | null }

async function fetchDetail(slug: string): Promise<Detail> {
  const url = `${BASE}/companies/${slug}`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    let website: string | null = null;
    $("a[href^=http]").each((_, a) => {
      const href = ($(a).attr("href") ?? "").trim();
      if (!href || !isCompanyUrl(href)) return;
      website = href;
      return false;
    });
    return { slug, website };
  } catch {
    return { slug, website: null };
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

const EXIT_STATUSES = new Set(["Acquired", "Defunct", "Closed", "Shut down"]);

export const localglobeAdapter: IngestorAdapter = {
  name: "LocalGlobe",
  source: "localglobe",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { limit, concurrency } = parseArgs();
    const items = await fetchAllListings();
    console.log(`[LocalGlobe] api yielded ${items.length} unique companies`);

    const active = items.filter((i) => !EXIT_STATUSES.has(i.status));
    console.log(`[LocalGlobe] active: ${active.length}, exits filtered: ${items.length - active.length}`);

    const work = limit ? active.slice(0, limit) : active;

    let progressDone = 0;
    const startedAt = Date.now();
    const details = await mapConcurrent(work, concurrency, async (it) => {
      const d = await fetchDetail(it.slug);
      progressDone++;
      if (progressDone % 25 === 0 || progressDone === work.length) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[LocalGlobe] details ${progressDone}/${work.length} (${elapsed}s)`);
      }
      return d;
    });

    const out: CompanyRecord[] = [];
    let noWebsite = 0;
    for (let i = 0; i < work.length; i++) {
      const it = work[i];
      const d = details[i];
      if (!d.website) { noWebsite++; continue; }
      out.push({
        name: it.name,
        website: d.website,
        oneLiner: it.standfirst,
        sourceId: it.slug,
        investors: ["localglobe"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    console.log(`[LocalGlobe] fetchAndParse DONE: ${out.length} kept — ${noWebsite} no-website`);
    return out;
  },
};

export async function ingestLocalGlobe(): Promise<void> {
  await runIngestor(localglobeAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestLocalGlobe().finally(() => prisma.$disconnect()).catch(console.error);
}
