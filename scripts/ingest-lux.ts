import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { exaSearch } from "../server/lib/ai/exa-search.js";

// Lux Capital portfolio at https://www.luxcapital.com/companies.
//
// Lux is a genuine "names but no URLs" dead end: the listing renders only
// 24 cards (no scroll/lazy-load expansion observed), but the sitemap
// exposes all 213 /companies/<slug> URLs. Detail pages, however, do NOT
// surface the company's external website — only Lux's internal /companies/
// path. Confirmed both via plain HTTP and Playwright render.
//
// So we use the names→Exa pattern: sitemap → slug → slug-to-title name →
// Exa `category=company` query → canonical homepage. One Exa call per
// company (~$0.005 each, ~$1 for 213 names).
//
// Cost: ~$1 in Exa credits at numResults=1.
//
// Usage:
//   npx tsx scripts/ingest-lux.ts                # all sitemap slugs
//   npx tsx scripts/ingest-lux.ts --limit 10     # smoke test
//   npx tsx scripts/ingest-lux.ts --concurrency 4

const SITEMAP_URL = "https://www.luxcapital.com/sitemap.xml";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
  // Trailing "-c", "-2", "-6", etc. are deduplication tokens Webflow adds
  // when two companies share a slug. Strip them for name display + Exa query.
  const cleaned = slug.replace(/-[a-z]?\d?$/, "").replace(/-\d+$/, "");
  return cleaned
    .split("-")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

async function fetchSitemapSlugs(): Promise<string[]> {
  console.log(`[Lux] GET ${SITEMAP_URL}`);
  const { data: xml } = await axios.get<string>(SITEMAP_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  const slugs = new Set<string>();
  for (const m of xml.matchAll(/\/companies\/([a-z0-9-]+)/g)) {
    slugs.add(m[1]);
  }
  return [...slugs];
}

interface Resolved {
  slug: string;
  name: string;
  website: string | null;
  description: string | null;
}

async function resolveOneViaExa(slug: string, apiKey: string): Promise<Resolved> {
  const name = slugToTitle(slug);
  try {
    const resp = await exaSearch({
      query: `${name} startup company Lux Capital portfolio`,
      apiKey,
      numResults: 1,
      type: "auto",
      category: "company",
      textMaxCharacters: 600,
    });
    const r = resp.results[0];
    if (!r || !r.url) return { slug, name, website: null, description: null };

    // Exa's text response format: first line is "# <Display> (<Legal>)"
    // followed by "<Display> is a <industry> company." Pull a one-liner
    // from the second line when present.
    let displayName = name;
    let oneLiner: string | null = null;
    if (r.content) {
      const firstLine = r.content.split("\n")[0]?.replace(/^#\s*/, "").trim();
      if (firstLine && firstLine.length > 1 && firstLine.length < 100) {
        // Strip "(Legal)" suffix.
        const display = firstLine.replace(/\s*\([^)]+\)\s*$/, "").trim();
        if (display) displayName = display;
      }
      const secondLine = r.content.split("\n")[1]?.trim();
      if (secondLine && secondLine.length > 5 && secondLine.length < 300) {
        oneLiner = secondLine;
      }
    }

    return { slug, name: displayName, website: r.url, description: oneLiner };
  } catch (err) {
    console.warn(`[Lux] Exa failed for ${slug}: ${err instanceof Error ? err.message : err}`);
    return { slug, name, website: null, description: null };
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

export const luxAdapter: IngestorAdapter = {
  name: "Lux",
  source: "lux",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) throw new Error("EXA_API_KEY is required");

    const { limit, concurrency } = parseArgs();
    const slugs = await fetchSitemapSlugs();
    const work = limit ? slugs.slice(0, limit) : slugs;
    console.log(`[Lux] ${slugs.length} sitemap slugs; resolving ${work.length} via Exa at concurrency ${concurrency}`);

    let progressDone = 0;
    const startedAt = Date.now();

    const resolved = await mapConcurrent(work, concurrency, async (slug) => {
      const r = await resolveOneViaExa(slug, apiKey);
      progressDone++;
      if (progressDone % 20 === 0 || progressDone === work.length) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[Lux] resolved ${progressDone}/${work.length} (${elapsed}s)`);
      }
      return r;
    });

    const out: CompanyRecord[] = [];
    let noWebsite = 0;
    for (const r of resolved) {
      if (!r.website) {
        noWebsite++;
        continue;
      }
      out.push({
        name: r.name,
        website: r.website,
        oneLiner: r.description,
        sourceId: r.slug,
        investors: ["lux"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    console.log(`[Lux] fetchAndParse DONE: ${out.length} kept — ${noWebsite} no-website`);
    return out;
  },
};

export async function ingestLux(): Promise<void> {
  await runIngestor(luxAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestLux().finally(() => prisma.$disconnect()).catch(console.error);
}
