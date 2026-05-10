import { prisma, type Db } from "./prisma.js";

export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function consumeDurableDailyQuota(
  scope: string,
  subjectId: string,
  action: string,
  limit: number,
  db: Db = prisma,
): Promise<void> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.round(limit)) : 1;
  const day = todayKey();
  const row = await db.dailyQuota.upsert({
    where: {
      scope_subjectId_action_day: { scope, subjectId, action, day },
    },
    create: { scope, subjectId, action, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (row.count > safeLimit) {
    throw new QuotaError(`Daily ${action} limit reached (${safeLimit}). Try again tomorrow.`);
  }
}

// Atomically reserves one email send slot for today.
//
// Keyed on the Gmail address (scope='gmail'), NOT the Sparrow user id. The
// Gmail account is the thing being rate-limited at the upstream provider,
// and it persists across Sparrow account deletion + re-signup — so a user
// can't bypass the limit by deleting their account and recreating it.
//
// How it works: atomically upsert-increments the DailyQuota counter for the
// Gmail address. PostgreSQL serializes concurrent increments on the same row,
// so each caller gets a distinct count. If the count exceeds the limit, the
// increment is rolled back and QuotaError is thrown — no slot consumed.
//
// Returns a `release` function. Call it if the send fails after reservation
// (Gmail error, claim collision, etc.) to restore the slot so the draft stays
// retryable. Do NOT call release if Gmail accepted the message — the slot is
// consumed regardless of whether the DB write that follows succeeds.
export async function reserveEmailSendQuota(
  gmailEmail: string,
  limit: number,
  db: Db = prisma,
): Promise<() => Promise<void>> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.round(limit)) : 1;
  const day = todayKey();
  const key = { scope: "gmail", subjectId: gmailEmail.toLowerCase(), action: "email_send", day };

  const row = await db.dailyQuota.upsert({
    where: { scope_subjectId_action_day: key },
    create: { ...key, count: 1 },
    update: { count: { increment: 1 } },
  });

  const release = async () => {
    try {
      await db.dailyQuota.update({
        where: { scope_subjectId_action_day: key },
        data: { count: { decrement: 1 } },
      });
    } catch (err) {
      // Non-fatal: quota may be slightly over-counted for the rest of the day.
      console.warn("Failed to release email send quota slot:", err);
    }
  };

  if (row.count > safeLimit) {
    await release();
    throw new QuotaError(`Daily send limit reached (${safeLimit}/${safeLimit}). Try again tomorrow.`);
  }

  return release;
}

// Pre-flight check for batch sends. Not the source of truth — reserveEmailSendQuota
// is. This just gives a cleaner error message when the user is clearly at the cap.
export async function checkEmailSendQuota(
  userId: string,
  limit: number,
  db: Db = prisma,
): Promise<void> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.round(limit)) : 1;
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);

  const count = await db.email.count({
    where: {
      status: "sent",
      sentAt: { gte: midnight },
      OR: [{ userLead: { userId } }, { customContact: { userId } }],
    },
  });

  if (count >= safeLimit) {
    throw new QuotaError(`Daily send limit reached (${safeLimit}/${safeLimit}). Try again tomorrow.`);
  }
}
