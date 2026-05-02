type DailyBucket = Record<string, number> & { day: string };

const dailyBuckets = new Map<string, DailyBucket>();

export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function consumeDailyQuota(
  scope: string,
  subjectId: string,
  action: string,
  limit: number,
): void {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.round(limit)) : 1;
  const key = `${scope}:${subjectId}`;
  const day = todayKey();
  const existing = dailyBuckets.get(key);
  const bucket = existing?.day === day ? existing : ({ day } as DailyBucket);
  const used = bucket[action] ?? 0;
  if (used >= safeLimit) {
    throw new QuotaError(`Daily ${action} limit reached (${safeLimit}). Try again tomorrow.`);
  }
  bucket[action] = used + 1;
  dailyBuckets.set(key, bucket);
}
