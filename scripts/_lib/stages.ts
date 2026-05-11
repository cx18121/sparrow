// Canonical stage taxonomy. The wizard renders the union of these and the
// realized stages found in the DB, so users can pre-select Series D even
// before the DB has a row at that stage. Ordering is by funding progression
// — both the campaign-options API and any future stage-sorted UI rely on
// this array being chronologically ordered.
//
// "Series C+" is kept as a legacy aggregation bucket: a16z and Accel's
// growth-fund tags don't tell us the company's current round, only that
// it's past Series B, so they emit "Series C+" rather than guessing. New
// sources with granular stage info (Pear) emit the specific Series C / D
// / E values directly. A follow-up ordinal-aware filter could collapse
// these on read; today they coexist as separate buckets.

export const CANONICAL_STAGES = [
  "Pre-Seed",
  "Seed",
  "Series A",
  "Series B",
  "Series C",
  "Series D",
  "Series E",
  "Series C+",
] as const;

export type CanonicalStage = (typeof CANONICAL_STAGES)[number];

// Stable index for sorting — earlier stages come first. Unknown values get
// a high index so they sort to the end.
const STAGE_ORDER = new Map<string, number>(
  CANONICAL_STAGES.map((s, i) => [s, i]),
);

export function stageSortKey(stage: string | null | undefined): number {
  if (!stage) return Number.MAX_SAFE_INTEGER;
  const idx = STAGE_ORDER.get(stage);
  return idx ?? Number.MAX_SAFE_INTEGER - 1;
}

// Merge realized DB stages with the canonical list, deduped and sorted by
// canonical order. Realized-only stages (e.g. legacy values from older
// scrapers) keep their alphabetical order and append after the canonical
// run.
export function mergeStages(realized: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of CANONICAL_STAGES) {
    if (realized.includes(s)) {
      out.push(s);
      seen.add(s);
    }
  }
  // Canonical stages with zero realized rows appear after the realized run
  // so users see real options first but can still reach the empty buckets.
  for (const s of CANONICAL_STAGES) {
    if (!seen.has(s)) {
      out.push(s);
      seen.add(s);
    }
  }
  // Anything realized but non-canonical gets appended at the end, sorted.
  const extras = realized.filter((s) => !seen.has(s)).sort();
  return [...out, ...extras];
}
