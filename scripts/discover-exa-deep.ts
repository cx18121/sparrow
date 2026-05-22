import "dotenv/config";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { exaSearch } from "../server/lib/ai/exa-search.js";
import { resultToRecord } from "./ingest-exa-discovery.js";

// Bulk Exa discovery via a curated batch of stage-qualified topical queries.
// Net-new yield comes from cohort cuts (seed/A/B/C+ × sector) that the
// per-VC adapters miss — companies funded by firms with no public portfolio
// page (Tiger, Bond, Benchmark, …) plus bootstrapped growth-stage rows.
//
// Pivot history: the prior arm of this script used Exa /findSimilar from
// low-coverage seeds (hn-hiring, thehub) per .planning/ROADMAP.md Strategy 1.
// Pilot showed /findSimilar surfaces dominantly dead-domain / SEO long-tail
// pages regardless of seed quality — 60-70% drop rate at the HEAD gate and
// the survivors weren't venture-scale. /search + category=company driven by
// stage-qualified queries is materially higher quality.
//
// Usage:
//   npx tsx scripts/discover-exa-deep.ts --dry-run
//   npx tsx scripts/discover-exa-deep.ts --per-query 50
//   npx tsx scripts/discover-exa-deep.ts --queries-file ./queries.tsv --dry-run
//
//   --per-query N      results per query, caps at 100 (default 50)
//   --queries-file P   path to TSV file with `topic\tquery` lines; overrides
//                      the baked-in DEFAULT_QUERIES list
//   --no-head          skip the HTTP-liveness gate (faster, accepts dead)
//   --dry-run          collect + report yield, skip the upsert
//
// Quality gates (cheap → expensive):
//   1. Parse gate — drop results where the canonical "<Name> is a <industry>
//      company." phrase didn't parse out of Exa's text. Strong discriminator
//      against malformed / stale entries.
//   2. HEAD gate — parallel HTTP HEAD with timeout; drop non-2xx (404, dead
//      hostnames). Catches what gate 1 misses.

interface QueryDef {
  topic: string;
  query: string;
}

// Baked-in batch: stage × sector queries that target cohorts the per-VC
// adapters can't reach. ~60 queries × $0.007 ≈ $0.40 per full run.
//
// Each row's `topic` slug lands as a Company tag (via resultToRecord →
// runIngestor → buildTags) so downstream filtering can roll by stage+sector.
const DEFAULT_QUERIES: QueryDef[] = [
  // Seed
  { topic: "seed-ai-2025",      query: "seed stage AI startup 2025" },
  { topic: "seed-saas-2025",    query: "seed stage SaaS startup 2025" },
  { topic: "seed-fintech-2025", query: "seed stage fintech startup 2025" },
  { topic: "seed-devtools-2025",query: "seed stage developer tools startup 2025" },
  { topic: "seed-security-2025",query: "seed stage cybersecurity startup 2025" },
  { topic: "seed-health-2025",  query: "seed stage healthtech startup 2025" },
  { topic: "seed-data-2025",    query: "seed stage data infrastructure startup 2025" },
  { topic: "seed-bio-2025",     query: "seed stage biotech startup 2025" },
  { topic: "seed-climate-2025", query: "seed stage climate tech startup 2025" },
  { topic: "seed-robotics-2025",query: "seed stage robotics startup 2025" },

  // Series A
  { topic: "a-ai-2025",       query: "Series A AI startup 2025" },
  { topic: "a-saas-2025",     query: "Series A SaaS startup 2025" },
  { topic: "a-fintech-2025",  query: "Series A fintech company 2025" },
  { topic: "a-devtools-2025", query: "Series A developer tools company 2025" },
  { topic: "a-security-2025", query: "Series A cybersecurity company 2025" },
  { topic: "a-health-2025",   query: "Series A healthtech company 2025" },
  { topic: "a-data-2025",     query: "Series A data infrastructure company 2025" },
  { topic: "a-marketing-2025",query: "Series A marketing technology company 2025" },
  { topic: "a-sales-2025",    query: "Series A sales software company 2025" },
  { topic: "a-hr-2025",       query: "Series A HR tech company 2025" },
  { topic: "a-vertical-2025", query: "Series A vertical SaaS company 2025" },
  { topic: "a-climate-2025",  query: "Series A climate tech company 2025" },

  // Series B
  { topic: "b-ai-2025",       query: "Series B AI startup 2025" },
  { topic: "b-saas-2025",     query: "Series B SaaS company 2025" },
  { topic: "b-fintech-2025",  query: "Series B fintech company 2025" },
  { topic: "b-devtools-2025", query: "Series B developer tools company 2025" },
  { topic: "b-security-2025", query: "Series B cybersecurity company 2025" },
  { topic: "b-health-2025",   query: "Series B healthtech company 2025" },
  { topic: "b-data-2025",     query: "Series B data infrastructure company 2025" },
  { topic: "b-marketing-2025",query: "Series B marketing technology company 2025" },
  { topic: "b-vertical-2025", query: "Series B vertical SaaS company 2025" },
  { topic: "b-climate-2025",  query: "Series B climate tech company 2025" },

  // Series C+
  { topic: "c-ai-2025",      query: "Series C AI company 2025" },
  { topic: "c-saas-2025",    query: "Series C SaaS company 2025" },
  { topic: "c-fintech-2025", query: "Series C fintech company 2025" },
  { topic: "c-security-2025",query: "Series C cybersecurity company 2025" },
  { topic: "c-health-2025",  query: "Series C healthtech company 2025" },
  { topic: "c-data-2025",    query: "Series C data infrastructure company 2025" },
  { topic: "c-vertical-2025",query: "Series C vertical SaaS company 2025" },
  { topic: "d-ai-2025",      query: "Series D AI company 2025" },
  { topic: "d-saas-2025",    query: "Series D SaaS company 2025" },
  { topic: "d-fintech-2025", query: "Series D fintech company 2025" },
  { topic: "growth-ai-2025", query: "growth stage AI company 2025" },
  { topic: "growth-saas-2025",query: "growth stage SaaS company 2025" },

  // Non-US cohorts — addresses region-dark gap (~5% of DB has region: null,
  // mostly because US-VC scrapes don't surface European/Asian companies)
  { topic: "eu-a-2025",         query: "European Series A startup 2025" },
  { topic: "eu-b-2025",         query: "European Series B startup 2025" },
  { topic: "uk-startup-2025",   query: "UK startup Series A B 2025" },
  { topic: "germany-startup-2025", query: "Germany Series A B startup 2025" },
  { topic: "france-startup-2025",  query: "France Series A B startup 2025" },
  { topic: "india-startup-2025",   query: "India Series A B startup 2025" },
  { topic: "sea-startup-2025",     query: "Southeast Asia Series A B startup 2025" },
  { topic: "latam-startup-2025",   query: "Latin America Series A B startup 2025" },

  // Bootstrapped — the explicit "not on portfolio pages" cohort
  { topic: "bootstrapped-saas",  query: "bootstrapped SaaS company growing 2025" },
  { topic: "bootstrapped-dev",   query: "bootstrapped developer tools company 2025" },
  { topic: "profitable-startup", query: "profitable startup company 2025" },
];

interface CliArgs {
  perQuery: number;
  queriesFile: string | null;
  noHead: boolean;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv;
  const find = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
  };
  const perQuery = Math.max(1, Math.min(100, parseInt(find("--per-query") ?? "50", 10) || 50));
  const queriesFile = find("--queries-file") ?? null;
  const noHead = argv.includes("--no-head");
  const dryRun = argv.includes("--dry-run");
  return { perQuery, queriesFile, noHead, dryRun };
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function loadQueriesFile(path: string): QueryDef[] {
  const raw = readFileSync(path, "utf8");
  const out: QueryDef[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [topic, ...rest] = trimmed.split("\t");
    const query = rest.join("\t").trim();
    if (!topic || !query) continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(topic)) {
      throw new Error(`bad topic slug "${topic}" in ${path}`);
    }
    out.push({ topic, query });
  }
  if (out.length === 0) throw new Error(`no queries found in ${path}`);
  return out;
}

async function loadKnownDomains(): Promise<Set<string>> {
  const rows = await prisma.company.findMany({ select: { domain: true } });
  return new Set(rows.map((r) => r.domain));
}

const EXA_CONCURRENCY = 4;

const HEAD_TIMEOUT_MS = 8_000;
const HEAD_CONCURRENCY = 20;

async function checkLiveness(domains: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  let cursor = 0;
  const startedAt = Date.now();

  const checkOne = async (domain: string): Promise<void> => {
    const url = `https://${domain}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
      out.set(domain, resp.status >= 200 && resp.status < 400);
    } catch {
      // Some hosts 405 or drop HEAD. Retry GET to disambiguate dead-vs-fussy.
      try {
        const resp = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
        out.set(domain, resp.status >= 200 && resp.status < 400);
      } catch {
        out.set(domain, false);
      }
    } finally {
      clearTimeout(timer);
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= domains.length) return;
      await checkOne(domains[i]);
      if ((i + 1) % 50 === 0) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[discover] HEAD ${i + 1}/${domains.length} (${elapsed}s)`);
      }
    }
  };

  console.log(`[discover] HEAD checking ${domains.length} candidates (concurrency ${HEAD_CONCURRENCY})`);
  await Promise.all(Array.from({ length: HEAD_CONCURRENCY }, () => worker()));
  return out;
}

async function discover(args: CliArgs): Promise<void> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error("EXA_API_KEY is required");

  const queries = args.queriesFile ? loadQueriesFile(args.queriesFile) : DEFAULT_QUERIES;
  console.log(`[discover] ${queries.length} queries × ${args.perQuery} results = up to ${queries.length * args.perQuery} candidates`);

  const known = await loadKnownDomains();
  console.log(`[discover] DB has ${known.size} known domains`);

  // domain -> CompanyRecord. Cross-query dedupe.
  const candidates = new Map<string, CompanyRecord>();
  let calls = 0;
  let dupesAcrossQueries = 0;
  let alreadyKnown = 0;
  let parseFailed = 0;

  const runOne = async (q: QueryDef): Promise<void> => {
    calls++;
    let resp;
    try {
      resp = await exaSearch({
        query: q.query,
        apiKey,
        numResults: args.perQuery,
        type: "auto",
        category: "company",
        textMaxCharacters: 800,
      });
    } catch (err) {
      console.warn(`[discover] search failed for "${q.query}": ${err instanceof Error ? err.message : err}`);
      return;
    }
    let kept = 0;
    let known_ = 0;
    let dupe = 0;
    let parsed = 0;
    for (const r of resp.results) {
      const domain = extractDomain(r.url);
      if (!domain) continue;
      if (known.has(domain)) {
        known_++;
        alreadyKnown++;
        continue;
      }
      if (candidates.has(domain)) {
        dupe++;
        dupesAcrossQueries++;
        continue;
      }
      const rec = resultToRecord(r, q.topic);
      if (!rec) continue;
      if (!rec.industry) {
        parsed++;
        parseFailed++;
        continue;
      }
      // Keep the existing exa-discovery signal so these rows merge into the
      // same DB cohort as the 2026-05-11 seed run.
      rec.signals = ["exa-discovery"];
      candidates.set(domain, rec);
      kept++;
    }
    console.log(
      `[discover] ${calls}/${queries.length} ${q.topic} → ${resp.results.length} results, ${kept} new, ${known_} known, ${dupe} cross-query dupe, ${parsed} parse-fail`
    );
  };

  const inFlight = new Set<Promise<void>>();
  for (const q of queries) {
    while (inFlight.size >= EXA_CONCURRENCY) {
      await Promise.race(inFlight);
    }
    const p = runOne(q).finally(() => inFlight.delete(p));
    inFlight.add(p);
  }
  await Promise.all(inFlight);

  console.log(
    `\n[discover] post-parse: ${queries.length} queries → ${candidates.size} net-new candidates (${alreadyKnown} already in DB, ${dupesAcrossQueries} cross-query dupes, ${parseFailed} parse-fail)`
  );

  if (!args.noHead && candidates.size > 0) {
    const liveness = await checkLiveness(Array.from(candidates.keys()));
    let dropped = 0;
    for (const [domain, alive] of liveness) {
      if (!alive) {
        candidates.delete(domain);
        dropped++;
      }
    }
    console.log(`[discover] post-HEAD: ${candidates.size} survived, ${dropped} dropped as non-2xx/timeout`);
  }

  if (args.dryRun) {
    const sample = Array.from(candidates.values()).slice(0, 20);
    console.log(`\n[discover] --dry-run: skipping upsert. Sample of net-new candidates:`);
    for (const c of sample) {
      console.log(`  - ${c.name} (${c.website}) — ${c.industry ?? "no industry"}`);
    }
    return;
  }

  const records = Array.from(candidates.values());
  const adapter: IngestorAdapter = {
    name: "ExaDeep",
    source: "exa-discovery",
    async fetchAndParse() {
      return records;
    },
  };
  await runIngestor(adapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  discover(args).finally(() => prisma.$disconnect()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
