import "dotenv/config";
import { pathToFileURL } from "node:url";
import { runBackfill, type BackfillBackend, type CompanyRow, type SearchOutcome } from "./_lib/backfill-stage-location.js";
import { exaSearch } from "../server/lib/ai/exa-search.js";

// One-shot stage + location backfill via Exa. Sibling to
// backfill-stage-location-tavily.ts — same pipeline (shared in
// _lib/backfill-stage-location.ts), different retrieval backend. Built
// because Tavily hit its monthly quota partway through the 2026-05-13
// pass with ~2,400 stage-null rows still untouched; this script picks up
// where Tavily left off without re-paying for already-enriched rows.
//
// Backend-specific deltas vs Tavily:
//   - Exa /search with category="news" and a 5-year recency window. News
//     coverage carries funding-announcement signal more cleanly than
//     Tavily's general search would surface from homepage prose. The
//     date filter trims out Series A press releases from 2014 for
//     companies that have since raised through D/E.
//   - Two extra CLI flags: --skip-tavily-tried (skip rows Tavily already
//     whiffed on — they're more likely to whiff again) and --source
//     (scope the run to a single Company.source bucket).
//
// Usage:
//   npx tsx scripts/backfill-stage-location-exa.ts --dry-run --limit 20
//   npx tsx scripts/backfill-stage-location-exa.ts --limit 100
//   npx tsx scripts/backfill-stage-location-exa.ts                       # full pass
//   npx tsx scripts/backfill-stage-location-exa.ts --concurrency 6
//   npx tsx scripts/backfill-stage-location-exa.ts --skip-tavily-tried
//   npx tsx scripts/backfill-stage-location-exa.ts --only stage

const DEFAULT_EXA_RESULTS = 5;
const PER_RESULT_CHARS = 1200;
// 5-year recency window — covers the typical funding velocity of a
// company in this corpus (Pre-Seed → Series E in 4-6 years). Older press
// releases create noise where regex picks up the earliest round instead
// of the latest.
const RECENCY_YEARS = 5;

function buildExaQuery(c: CompanyRow): string {
  // Tighter than the Tavily query because Exa's news category already
  // filters out homepage prose. "raised" and "funding round" pin the
  // topical surface; quoted name pins the entity; domain disambiguates
  // similarly-named companies.
  return `"${c.name}" ${c.domain} raised funding round Series`;
}

function isoNYearsAgo(n: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

const startPublishedDate = isoNYearsAgo(RECENCY_YEARS);

const exaBackend: BackfillBackend = {
  name: "exa",
  tagTried: "exa-stage-tried",
  tagEnriched: "exa-stage-enriched",
  apiKeyEnv: "EXA_API_KEY",
  defaultResults: DEFAULT_EXA_RESULTS,
  buildQuery: buildExaQuery,
  paramsSummary: ({ concurrency, results, model }) =>
    `Concurrency: ${concurrency}, Exa results: ${results}, recency: ${RECENCY_YEARS}y (since ${startPublishedDate}), model: ${model}`,
  async search({ query, apiKey, numResults }): Promise<SearchOutcome> {
    try {
      const resp = await exaSearch({
        query,
        apiKey,
        numResults,
        type: "auto",
        category: "news",
        textMaxCharacters: PER_RESULT_CHARS,
        startPublishedDate,
      });
      if (resp.results.length === 0) return { kind: "empty" };
      const blob = resp.results
        .map(r => `${r.title}\n${r.content.slice(0, PER_RESULT_CHARS)}`)
        .join("\n\n");
      return { kind: "ok", blob };
    } catch (err) {
      // exaSearch only throws on 401/403 (auth); transient 5xx already
      // returned an empty result set. Auth errors get tag-tried (don't
      // burn credits re-trying a misconfigured run) — driven by the
      // shared pipeline.
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  },
  parseExtraFlags(argv) {
    const extraNotTags: string[] = [];
    if (argv.includes("--skip-tavily-tried")) extraNotTags.push("tavily-tried");
    const sourceIdx = argv.indexOf("--source");
    const sourceFilter = sourceIdx !== -1 ? (argv[sourceIdx + 1] ?? null) : null;
    return { extraNotTags, sourceFilter };
  },
};

export async function backfillStageLocationExa(): Promise<void> {
  await runBackfill(exaBackend);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillStageLocationExa().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
