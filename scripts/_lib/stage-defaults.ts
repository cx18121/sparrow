import { stageSortKey, type CanonicalStage } from "./stages.js";

// Heuristic stage inference from tags. Used by upsertCompany and the
// backfill-stage-defaults script to fill stage on rows whose source page
// didn't publish stage data (most growth-stage VC portfolio surfaces:
// Insight, General Atlantic, Summit, Battery, etc.).
//
// Rules are intentionally narrow — only investors with a documented
// stage thesis are encoded here. Mixed-thesis firms (Coatue's hedge fund
// does late-stage but their venture fund does seed; Khosla holds post-IPO
// publics) are skipped to keep false-positive rate low.
//
// Output rows are tagged with `signal:stage-inferred` by the caller so
// they can be audited or stripped if the rules turn out wrong. Source-of-
// truth stages from adapters that DO publish stage (YC's growth_stage
// taxonomy, Pear's per-company stage, Craft's fs-cmsfilter, Balderton's
// inline labels) take precedence — this function only fires when the
// final stage would otherwise be null.

export interface StageRule {
  matchTag: string;          // exact tag to match against Company.tags
  stage: CanonicalStage;
  rationale: string;         // free-form justification — surfaced by backfill --verbose
}

const STAGE_RULES: StageRule[] = [
  // YC alumni default to Seed. The yc adapter's mapYCStage emits
  // Seed/Series B/Series C+ from c.stage when present, but the default
  // branch passes empty/null inputs through unchanged, leaving a tail
  // of null-stage YC rows. This rule catches that tail.
  { matchTag: "signal:yc-backed", stage: "Seed", rationale: "YC alumni default to Seed (catches mapYCStage default-branch tail)" },

  // Growth-equity firms — clearly late-stage thesis.
  { matchTag: "investor:insight", stage: "Series C+", rationale: "Insight Partners is growth equity" },
  { matchTag: "investor:general-atlantic", stage: "Series C+", rationale: "General Atlantic is growth equity" },
  { matchTag: "investor:summit", stage: "Series C+", rationale: "Summit Partners is growth equity" },
  { matchTag: "investor:tcv", stage: "Series C+", rationale: "TCV is late-stage growth" },
  { matchTag: "investor:iconiq", stage: "Series C+", rationale: "ICONIQ Capital is late-stage growth" },

  // Mid-stage focus.
  { matchTag: "investor:battery", stage: "Series B", rationale: "Battery Ventures mid-stage focus" },

  // Seed-focused firms.
  { matchTag: "investor:boxgroup", stage: "Seed", rationale: "BoxGroup is seed-stage" },
  { matchTag: "investor:initialized", stage: "Seed", rationale: "Initialized Capital is seed-stage" },
  { matchTag: "investor:hoxton", stage: "Seed", rationale: "Hoxton Ventures is seed/early-stage" },
  { matchTag: "investor:pear", stage: "Seed", rationale: "Pear VC is pre-seed/seed" },
];

// Returns the inferred canonical stage for a row given its tag set, or null
// if no rule matches. When multiple rules apply (e.g. yc-backed + investor:
// insight on a YC alum that took Insight money), the highest-stage wins —
// late-stage investor presence indicates the company has reached at least
// that stage. Tiebreak uses stageSortKey (higher = later).
export function defaultStageFromTags(
  tags: string[] | null | undefined,
): CanonicalStage | null {
  if (!tags || tags.length === 0) return null;
  const tagSet = new Set(tags);
  let pickedStage: CanonicalStage | null = null;
  let pickedOrdinal = -1;
  for (const rule of STAGE_RULES) {
    if (!tagSet.has(rule.matchTag)) continue;
    const ord = stageSortKey(rule.stage);
    if (ord > pickedOrdinal) {
      pickedStage = rule.stage;
      pickedOrdinal = ord;
    }
  }
  return pickedStage;
}

// Returns the rule that won inference for a tag set, or null. Used by the
// backfill script's --verbose flag to surface which rule fired per row.
export function defaultStageRuleFromTags(
  tags: string[] | null | undefined,
): StageRule | null {
  if (!tags || tags.length === 0) return null;
  const tagSet = new Set(tags);
  let pickedRule: StageRule | null = null;
  let pickedOrdinal = -1;
  for (const rule of STAGE_RULES) {
    if (!tagSet.has(rule.matchTag)) continue;
    const ord = stageSortKey(rule.stage);
    if (ord > pickedOrdinal) {
      pickedRule = rule;
      pickedOrdinal = ord;
    }
  }
  return pickedRule;
}

export const STAGE_INFERRED_SIGNAL = "signal:stage-inferred";

// Exported for tests + the backfill script's summary output.
export { STAGE_RULES };
