import type { PrismaClient } from "@prisma/client";
import { prisma, type Db } from "./prisma.js";

export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// 'YYYY-MM-01' — anchored on the first of the month so all rows for a given
// month share one composite key (scope+subjectId+action+day). UTC.
function monthKey(): string {
  return new Date().toISOString().slice(0, 7) + "-01";
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

// Reserves one email send slot for both today AND the current month, in a
// single DB transaction.
//
// Keyed on the Gmail address (scope='gmail'), NOT the Sparrow user id. The
// Gmail account is the thing being rate-limited at the upstream provider,
// and it persists across Sparrow account deletion + re-signup — so a user
// can't bypass the limit by deleting their account and recreating it.
//
// Atomicity: both upsert-increments run inside one Postgres transaction.
// If either count exceeds its limit, throwing inside the transaction rolls
// back BOTH increments — neither counter ends up phantom-incremented. The
// transaction also protects against the process dying between the daily
// upsert and the monthly upsert (the previous implementation could leave
// the daily counter incremented in that crash window).
//
// Returns a `release` function. Call it if the send fails after the
// reservation has committed (Gmail error, claim collision, etc.) to
// decrement both slots so the draft stays retryable. Do NOT call release
// if Gmail accepted the message — the slots are consumed regardless of
// whether the DB write that follows succeeds.
export async function reserveEmailSendQuota(
  gmailEmail: string,
  dailyLimit: number,
  monthlyLimit: number,
  db: PrismaClient = prisma,
): Promise<() => Promise<void>> {
  const safeDaily = Number.isFinite(dailyLimit) ? Math.max(1, Math.round(dailyLimit)) : 1;
  const safeMonthly = Number.isFinite(monthlyLimit) ? Math.max(1, Math.round(monthlyLimit)) : 1;
  const subjectId = gmailEmail.toLowerCase();
  const dayK = { scope: "gmail", subjectId, action: "email_send", day: todayKey() };
  const monthK = { scope: "gmail", subjectId, action: "email_send_month", day: monthKey() };

  await db.$transaction(async (tx) => {
    const dayRow = await tx.dailyQuota.upsert({
      where: { scope_subjectId_action_day: dayK },
      create: { ...dayK, count: 1 },
      update: { count: { increment: 1 } },
    });
    if (dayRow.count > safeDaily) {
      throw new QuotaError(`Daily send limit reached (${safeDaily}/${safeDaily}). Try again tomorrow.`);
    }
    const monthRow = await tx.dailyQuota.upsert({
      where: { scope_subjectId_action_day: monthK },
      create: { ...monthK, count: 1 },
      update: { count: { increment: 1 } },
    });
    if (monthRow.count > safeMonthly) {
      throw new QuotaError(`Monthly send limit reached (${safeMonthly}/${safeMonthly}). Resets on the 1st.`);
    }
  });

  // Reservation committed. Release runs outside any transaction since the
  // two decrements are independent — they only fire when Gmail itself
  // rejected the send, never during the reservation race.
  return async () => {
    await Promise.all([
      makeReleaser(db, dayK, "daily")(),
      makeReleaser(db, monthK, "monthly")(),
    ]);
  };
}

function makeReleaser(
  db: Db,
  key: { scope: string; subjectId: string; action: string; day: string },
  label: string,
) {
  return async () => {
    try {
      await db.dailyQuota.update({
        where: { scope_subjectId_action_day: key },
        data: { count: { decrement: 1 } },
      });
    } catch (err) {
      console.warn(`Failed to release ${label} send quota slot:`, err);
    }
  };
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
