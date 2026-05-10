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

// Atomically reserves one email send slot for both today AND the current
// month.
//
// Keyed on the Gmail address (scope='gmail'), NOT the Sparrow user id. The
// Gmail account is the thing being rate-limited at the upstream provider,
// and it persists across Sparrow account deletion + re-signup — so a user
// can't bypass the limit by deleting their account and recreating it.
//
// How it works: two atomic upsert-increments — one for the daily counter
// (action='email_send', day='YYYY-MM-DD') and one for the monthly counter
// (action='email_send_month', day='YYYY-MM-01'). PostgreSQL serializes
// concurrent increments on the same row, so each caller gets a distinct
// count. If EITHER count exceeds its limit, the relevant increments are
// rolled back and QuotaError is thrown — no slot consumed.
//
// Returns a `release` function. Call it if the send fails after reservation
// (Gmail error, claim collision, etc.) to restore both slots so the draft
// stays retryable. Do NOT call release if Gmail accepted the message — the
// slots are consumed regardless of whether the DB write that follows succeeds.
export async function reserveEmailSendQuota(
  gmailEmail: string,
  dailyLimit: number,
  monthlyLimit: number,
  db: Db = prisma,
): Promise<() => Promise<void>> {
  const safeDaily = Number.isFinite(dailyLimit) ? Math.max(1, Math.round(dailyLimit)) : 1;
  const safeMonthly = Number.isFinite(monthlyLimit) ? Math.max(1, Math.round(monthlyLimit)) : 1;
  const subjectId = gmailEmail.toLowerCase();
  const dayK = { scope: "gmail", subjectId, action: "email_send", day: todayKey() };
  const monthK = { scope: "gmail", subjectId, action: "email_send_month", day: monthKey() };

  // 1. Reserve daily slot.
  const dayRow = await db.dailyQuota.upsert({
    where: { scope_subjectId_action_day: dayK },
    create: { ...dayK, count: 1 },
    update: { count: { increment: 1 } },
  });
  const releaseDay = makeReleaser(db, dayK, "daily");
  if (dayRow.count > safeDaily) {
    await releaseDay();
    throw new QuotaError(`Daily send limit reached (${safeDaily}/${safeDaily}). Try again tomorrow.`);
  }

  // 2. Reserve monthly slot. If the upsert itself throws, release the daily
  // increment we just took so the count stays accurate.
  let monthRow: { count: number };
  try {
    monthRow = await db.dailyQuota.upsert({
      where: { scope_subjectId_action_day: monthK },
      create: { ...monthK, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch (err) {
    await releaseDay();
    throw err;
  }
  const releaseMonth = makeReleaser(db, monthK, "monthly");
  if (monthRow.count > safeMonthly) {
    await Promise.all([releaseDay(), releaseMonth()]);
    throw new QuotaError(`Monthly send limit reached (${safeMonthly}/${safeMonthly}). Resets on the 1st.`);
  }

  return async () => {
    await Promise.all([releaseDay(), releaseMonth()]);
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
