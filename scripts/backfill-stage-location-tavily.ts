import "dotenv/config";
import { pathToFileURL } from "node:url";
import { runBackfill, type BackfillBackend, type CompanyRow, type SearchOutcome } from "./_lib/backfill-stage-location.js";
import { tavilySearch, TavilyQuotaError } from "../server/lib/ai/tavily-search.js";

// One-shot backfill: fills Company.stage and Company.location for verified
// rows where either is null, using one Tavily call per company. Both fields
// are extracted from the same snippet bundle so we only spend one credit
// per row regardless of which field(s) were missing.
//
// Pipeline lives in _lib/backfill-stage-location.ts (shared with the Exa
// sibling). This file is just the Tavily-flavored adapter.
//
// Usage:
//   npx tsx scripts/backfill-stage-location-tavily.ts --dry-run --limit 20
//   npx tsx scripts/backfill-stage-location-tavily.ts --limit 100
//   npx tsx scripts/backfill-stage-location-tavily.ts                  # full pass
//   npx tsx scripts/backfill-stage-location-tavily.ts --concurrency 8

const DEFAULT_TAVILY_RESULTS = 4;
const PER_RESULT_CHARS = 1200;

function buildTavilyQuery(c: CompanyRow): string {
  // Quoted name pins the entity; domain is a second disambiguator.
  // "raised" is the headline verb of nearly every funding press release;
  // "Series" OR "Seed" forces a round letter into the result set;
  // "headquarters" keeps the location signal in scope.
  return `"${c.name}" ${c.domain} raised "Series" OR "Seed" headquarters`;
}

const tavilyBackend: BackfillBackend = {
  name: "tavily",
  tagTried: "tavily-tried",
  tagEnriched: "tavily-enriched",
  apiKeyEnv: "TAVILY_API_KEY",
  defaultResults: DEFAULT_TAVILY_RESULTS,
  buildQuery: buildTavilyQuery,
  paramsSummary: ({ concurrency, results, model }) =>
    `Concurrency: ${concurrency}, Tavily results: ${results}, model: ${model}`,
  async search({ query, apiKey, numResults }): Promise<SearchOutcome> {
    try {
      const resp = await tavilySearch({
        query,
        apiKey,
        maxResults: numResults,
        searchDepth: "advanced",
        // Surface 402/429 as a typed error so we can abort the whole pass
        // without burning the tried tag on rows that were quota-blocked
        // rather than genuinely uninformative.
        throwOnQuota: true,
      });
      if (resp.results.length === 0) return { kind: "empty" };
      const blob = resp.results
        .map(r => `${r.title}\n${r.content.slice(0, PER_RESULT_CHARS)}`)
        .join("\n\n");
      return { kind: "ok", blob };
    } catch (err) {
      if (err instanceof TavilyQuotaError) {
        return { kind: "abort", message: `Tavily quota/rate-limit (${err.status}) — out of credits or rate-limited.` };
      }
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  },
};

export async function backfillStageLocationTavily(): Promise<void> {
  await runBackfill(tavilyBackend);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillStageLocationTavily().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
