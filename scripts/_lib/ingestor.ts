import { upsertCompany } from "./upsert.js";
import { buildTags, isFreeHostingDomain } from "./tags.js";
import { computeQualityScore } from "./quality-score.js";

// Generic ingestor runner. Each source provides an Adapter that knows how to
// fetch and parse its raw payload into CompanyRecord[]. The runner handles all
// shared infra: domain extraction, dedupe, free-hosting filter, tag and quality
// assembly, error handling, and tally logging.
//
// To add a new source: write fetchAndParse() that returns CompanyRecord[],
// wrap it in an IngestorAdapter, and call runIngestor(adapter).

export interface CompanyRecord {
  // Identifying fields — domain is extracted from website by the runner.
  website: string;
  name: string;

  // Optional content fields (mirror upsertCompany's accepted fields).
  description?: string | null;
  oneLiner?: string | null;
  stage?: string | null;
  industry?: string | null;
  subIndustry?: string | null;
  location?: string | null;
  headcount?: number | null;
  isHiring?: boolean | null;
  batch?: string | null;
  sourceId?: string | null;

  // Tag-building hints. The runner assembles the final tag list via buildTags.
  topics?: string[];
  investors?: string[];
  signals?: string[];

  // Quality hints. The runner assembles the final score via computeQualityScore.
  isVerified?: boolean;
}

export interface IngestorAdapter {
  // Log label, e.g. "YC", "TheHub". Used to namespace console output.
  name: string;
  // Persisted on Company.source, e.g. "yc", "thehub". Reconciliation rules
  // and the source-priority table key off this string.
  source: string;
  fetchAndParse: () => Promise<CompanyRecord[]>;
}

export interface IngestStats {
  ingested: number;
  skippedFreeHosting: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  failed: number;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Postgres connections can drop mid-run on long ingests (idle timeout, network
// blip). Prisma reconnects on the next query, so a small retry with backoff
// is enough to ride through transients without abandoning the row.
const TRANSIENT_DB_PATTERNS = [
  /connection terminated/i,
  /connection ended/i,
  /connection lost/i,
  /connection reset/i,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /socket hang up/i,
  /server has closed the connection/i,
];

function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return TRANSIENT_DB_PATTERNS.some((p) => p.test(err.message));
}

async function withDbRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || attempt === maxAttempts) throw err;
      const wait = 500 * attempt;
      console.warn(
        `[${label}] transient DB error (attempt ${attempt}/${maxAttempts}), retrying in ${wait}ms: ${err instanceof Error ? err.message : err}`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// How many upserts to run in flight at once. Bounded so we don't exhaust the
// DB connection pool (default pg pool is 10) and don't overwhelm Supabase's
// rate limits. The runner's `seen` set guarantees no two in-flight upserts
// touch the same domain, so this is race-safe.
const UPSERT_CONCURRENCY = parseInt(process.env.INGEST_CONCURRENCY ?? "8", 10);

export async function runIngestor(adapter: IngestorAdapter): Promise<IngestStats> {
  const stats: IngestStats = {
    ingested: 0,
    skippedFreeHosting: 0,
    skippedDuplicate: 0,
    skippedInvalid: 0,
    failed: 0,
  };

  let records: CompanyRecord[];
  try {
    records = await adapter.fetchAndParse();
  } catch (err) {
    console.error(
      `[${adapter.name}] fetch failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return stats;
  }

  const startedAt = Date.now();
  console.log(
    `[${adapter.name}] ${records.length} candidates — starting upsert (concurrency ${UPSERT_CONCURRENCY})`
  );

  const seen = new Set<string>();
  const total = records.length;
  const PROGRESS_EVERY_N = 100;
  const PROGRESS_EVERY_MS = 5000;
  let processed = 0;
  let lastLoggedAt = startedAt;

  const logProgress = (force = false) => {
    const now = Date.now();
    const due =
      force ||
      processed % PROGRESS_EVERY_N === 0 ||
      now - lastLoggedAt >= PROGRESS_EVERY_MS;
    if (!due) return;
    const elapsed = ((now - startedAt) / 1000).toFixed(1);
    const rate = processed > 0 ? (processed / ((now - startedAt) / 1000)).toFixed(1) : "0";
    console.log(
      `[${adapter.name}] ${processed}/${total} — ${stats.ingested} ingested, ${stats.failed} failed, ${stats.skippedDuplicate + stats.skippedFreeHosting + stats.skippedInvalid} skipped (${elapsed}s, ${rate}/s)`
    );
    lastLoggedAt = now;
  };

  // Sliding-window concurrency. Up to UPSERT_CONCURRENCY upserts run at once;
  // when the window is full we await the fastest one to settle before launching
  // the next. Sync work (validation, dedupe, tag/score build) stays in the main
  // loop so the in-memory `seen` set is updated before each launch.
  const inFlight = new Set<Promise<void>>();

  const launchUpsert = (
    r: CompanyRecord,
    domain: string,
    tags: string[],
    qualityScore: number
  ) => {
    const p = (async () => {
      try {
        await withDbRetry(
          () =>
            upsertCompany({
              domain,
              name: r.name,
              description: r.description ?? null,
              oneLiner: r.oneLiner ?? null,
              website: r.website,
              stage: r.stage ?? null,
              industry: r.industry ?? null,
              subIndustry: r.subIndustry ?? null,
              location: r.location ?? null,
              headcount: r.headcount ?? null,
              ...(r.isHiring != null && { isHiring: r.isHiring }),
              batch: r.batch ?? null,
              source: adapter.source,
              sourceId: r.sourceId ?? domain,
              tags,
              isVerified: r.isVerified ?? false,
              qualityScore,
            }),
          `${adapter.name} ${r.name}`
        );
        stats.ingested++;
      } catch (err) {
        stats.failed++;
        console.error(
          `[${adapter.name}] upsert failed for ${r.name} after retries: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        inFlight.delete(p);
        logProgress();
      }
    })();
    inFlight.add(p);
  };

  for (const r of records) {
    processed++;

    if (!r.website || !r.name) {
      stats.skippedInvalid++;
      logProgress();
      continue;
    }

    const domain = extractDomain(r.website);
    if (!domain) {
      stats.skippedInvalid++;
      logProgress();
      continue;
    }
    if (seen.has(domain)) {
      stats.skippedDuplicate++;
      logProgress();
      continue;
    }
    seen.add(domain);
    if (isFreeHostingDomain(domain)) {
      stats.skippedFreeHosting++;
      logProgress();
      continue;
    }

    const tags = buildTags({
      topics: r.topics,
      industry: r.industry ?? undefined,
      stage: r.stage ?? undefined,
      investors: r.investors,
      headcount: r.headcount ?? undefined,
      signals: r.signals,
    });

    const qualityScore = computeQualityScore({
      isVerified: r.isVerified,
      headcount: r.headcount ?? null,
      stage: r.stage ?? null,
      isHiring: r.isHiring ?? false,
      industry: r.industry ?? null,
    });

    while (inFlight.size >= UPSERT_CONCURRENCY) {
      await Promise.race(inFlight);
    }
    launchUpsert(r, domain, tags, qualityScore);
  }

  // Drain the window.
  await Promise.all(inFlight);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[${adapter.name}] DONE in ${elapsed}s — ingested ${stats.ingested}, skipped ${stats.skippedFreeHosting} free-hosting, ${stats.skippedDuplicate} duplicate, ${stats.skippedInvalid} invalid, ${stats.failed} failed`
  );
  return stats;
}
