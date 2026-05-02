import { mergeTags } from "./tags.js";

// Pure reconciliation logic for upserting a Company record. Decides what tags,
// flags, and score the merged row should hold given an existing row (or null
// for inserts) and the incoming observation. No DB, no I/O — testable in
// isolation.
//
// Rules:
// - tags: union via mergeTags; appearance from a new source adds
//   signal:multi-source.
// - isVerified: one-way ratchet. Once true, stays true.
// - qualityScore: max of old and new. The first time a domain crosses sources,
//   add a +10 multi-source bonus, capped at 100.
// - name overwrite: only when incoming source's priority is at least as high
//   as the existing source. Prevents low-priority scrapers (Gregslist) from
//   clobbering authoritative names from YC.

const SOURCE_PRIORITY: Record<string, number> = {
  yc: 3,
  accel: 2,
  kleinerperkins: 2,
  firstround: 2,
  initialized: 2,
  thehub: 2,
  a16z: 2,
  gv: 2,
  bessemer: 2,
  greylock: 2,
  foundersfund: 2,
  sequoia: 2,
  gregslist: 1,
  startups_gallery: 1,
  hn_hiring: 1,
};

export interface ExistingCompanyState {
  source: string;
  tags: string[];
  isVerified: boolean;
  qualityScore: number | null;
}

export interface IncomingCompanyState {
  source: string;
  tags: string[];
  isVerified: boolean;
  qualityScore: number | null;
}

export interface ReconcileResult {
  tags: string[];
  isVerified: boolean;
  qualityScore: number | null;
  shouldOverwriteName: boolean;
}

export function reconcileCompany(
  existing: ExistingCompanyState | null,
  incoming: IncomingCompanyState
): ReconcileResult {
  const mergedTags = mergeTags(existing?.tags, incoming.tags);
  const sourceChanged = !!(existing && existing.source !== incoming.source);
  if (sourceChanged && !mergedTags.includes("signal:multi-source")) {
    mergedTags.push("signal:multi-source");
  }

  const isVerified = (existing?.isVerified ?? false) || incoming.isVerified;

  const existingScore = existing?.qualityScore ?? null;
  const newScore = incoming.qualityScore;
  const baseScore =
    existingScore !== null && newScore !== null
      ? Math.max(existingScore, newScore)
      : existingScore ?? newScore;
  const isNewMultiSource =
    sourceChanged && !(existing!.tags ?? []).includes("signal:multi-source");
  const qualityScore = isNewMultiSource
    ? Math.min((baseScore ?? 0) + 10, 100)
    : baseScore;

  const incomingPriority = SOURCE_PRIORITY[incoming.source] ?? 1;
  const existingPriority = SOURCE_PRIORITY[existing?.source ?? ""] ?? 1;
  const shouldOverwriteName = incomingPriority >= existingPriority;

  return { tags: mergedTags, isVerified, qualityScore, shouldOverwriteName };
}
