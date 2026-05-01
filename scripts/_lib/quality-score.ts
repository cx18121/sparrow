// Composite 0-100 quality score. Higher = stronger candidate for cold outreach.
// Used to rank companies in the UI and to gate "real startup" cutoffs.
//
// Signals:
//   +20 verified domain (API-sourced or YC-confirmed)
//   +10 team size >= 5
//   +10 team size >= 20 (additional)
//   +10 funding stage Seed+
//   +10 funding stage Series A+ (additional)
//   +10 actively hiring
//   +5  has industry/topic categorization
//   +10 multi-source bonus (applied by upsertCompany when a second source touches the record)

export interface ScoreInput {
  isVerified?: boolean;
  headcount?: number | null;
  stage?: string | null;
  isHiring?: boolean;
  industry?: string | null;
}

export function computeQualityScore(input: ScoreInput): number {
  let score = 0;

  if (input.isVerified) score += 20;

  if (input.headcount != null) {
    if (input.headcount >= 5) score += 10;
    if (input.headcount >= 20) score += 10;
  }

  if (input.stage) {
    const s = input.stage.toLowerCase();
    const isPreSeed = s.includes("pre-seed") || s.includes("preseed");
    if (!isPreSeed && (s.includes("seed") || s.includes("series") || s.includes("growth"))) score += 10;
    if (s.includes("series a") || s.includes("series b") || s.includes("series c") ||
        s.includes("series d") || s.includes("series e") ||
        s.includes("growth") || s.includes("late")) score += 10;
  }

  if (input.isHiring) score += 10;
  if (input.industry) score += 5;

  return Math.min(score, 100);
}
