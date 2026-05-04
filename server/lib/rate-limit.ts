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

// Counts successful sends today and throws if the user is at or over the limit.
// Counts actual sent emails (not attempts) so transient Gmail failures don't
// consume quota — users can retry failed drafts without burning their daily allowance.
export async function checkEmailSendQuota(userId: string, limit: number, db: Db = prisma): Promise<void> {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const sentToday = await db.email.count({
    where: {
      status: "sent",
      sentAt: { gte: startOfToday },
      OR: [{ userLead: { userId } }, { customContact: { userId } }],
    },
  });
  if (sentToday >= limit) {
    throw new QuotaError(`Daily send limit reached (${sentToday}/${limit}). Try again tomorrow.`);
  }
}
