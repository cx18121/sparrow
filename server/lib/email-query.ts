import { prisma, type Db } from "./prisma.js";
import {
  emailDashboardCacheKey,
  getEmailDashboardCache,
  setEmailDashboardCache,
} from "./email-cache.js";

const emailInclude = {
  contact: { select: { id: true, name: true, email: true, title: true } },
  customContact: { select: { id: true, name: true, email: true, title: true, companyName: true } },
  userLead: {
    select: {
      id: true,
      status: true,
      // researchDossier is included so the draft-review "change angle"
      // picker can list the company's surfaces[] without a second fetch.
      // It's a small JSON blob (1-3 KB per company); the trade-off is one
      // extra column per email row.
      company: { select: { id: true, name: true, domain: true, researchDossier: true } },
    },
  },
} as const;

type EmailStatusFilter = "draft" | "sent" | "failed";

export interface EmailQueueParams {
  userLeadId?: string;
  campaignId?: string;
  status?: EmailStatusFilter;
  limit?: number;
  cursor?: string;
}

function sortNewestFirst<T extends { createdAt: Date }>(items: T[]) {
  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function page<T extends { id: string }>(items: T[], take: number) {
  const hasMore = items.length > take;
  const trimmed = hasMore ? items.slice(0, take) : items;
  return { items: trimmed, nextCursor: hasMore ? trimmed[trimmed.length - 1]?.id : null };
}

function pageAfterCursor<T extends { id: string }>(items: T[], take: number, cursor?: string) {
  const cursorIndex = cursor ? items.findIndex((item) => item.id === cursor) : -1;
  return page(cursorIndex >= 0 ? items.slice(cursorIndex + 1) : items, take);
}

export async function countEmailsSentToday(userId: string, db: Db = prisma) {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const [fromLeads, fromContacts] = await Promise.all([
    db.email.count({ where: { status: "sent", sentAt: { gte: startOfToday }, userLead: { userId } } }),
    db.email.count({ where: { status: "sent", sentAt: { gte: startOfToday }, customContact: { userId } } }),
  ]);
  return { count: fromLeads + fromContacts };
}

export interface DashboardSendStats {
  sentToday: number;
  sentLast7Days: number;
  sentThisMonth: number;
  sentTotal: number;
  repliedCount: number;
  openedCount: number;
}

// Aggregate send counts for the dashboard Send activity panel. Run as a
// batch of count queries (no row reads) so this stays cheap even for
// users with thousands of sends. Time windows are UTC-anchored to match
// the rate-limit bookkeeping in server/lib/rate-limit.ts:
//   - sentToday: since UTC midnight today (matches daily quota window).
//   - sentThisMonth: since UTC YYYY-MM-01 (matches monthly quota window).
//   - sentLast7Days: rolling 7-day window from now.
// repliedCount counts only ReplyClassification.REPLY — bounces and
// auto-replies don't count toward "real" replies.
// openedCount counts distinct sent emails with a recorded open (openedAt
// set by the tracking pixel in server/routes/track.ts). Pixel-based open
// tracking undercounts (image-blocking clients, proxy pre-fetch inflates)
// — treat it as a directional signal, not an exact figure.
export async function readDashboardSendStats(userId: string, db: Db = prisma): Promise<DashboardSendStats> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const ownership = { OR: [{ userLead: { userId } }, { customContact: { userId } }] };
  const sentBase = { status: "sent" as const, ...ownership };

  const [
    sentToday,
    sentLast7Days,
    sentThisMonth,
    sentTotal,
    repliedCount,
    openedCount,
  ] = await Promise.all([
    db.email.count({ where: { ...sentBase, sentAt: { gte: startOfToday } } }),
    db.email.count({ where: { ...sentBase, sentAt: { gte: sevenDaysAgo } } }),
    db.email.count({ where: { ...sentBase, sentAt: { gte: startOfMonth } } }),
    db.email.count({ where: sentBase }),
    db.email.count({ where: { ...sentBase, replyClassification: "REPLY" } }),
    db.email.count({ where: { ...sentBase, openedAt: { not: null } } }),
  ]);

  return { sentToday, sentLast7Days, sentThisMonth, sentTotal, repliedCount, openedCount };
}

export async function readDashboardEmailQueue(
  userId: string,
  params: { campaignId?: string } = {},
  db: Db = prisma,
) {
  const { campaignId } = params;
  const cacheKey = emailDashboardCacheKey(userId, campaignId);
  const cached = getEmailDashboardCache(cacheKey);
  // Old cache entries from before stats were added are missing the field —
  // treat them as a miss so the new dashboard renders correctly.
  if (cached && (cached as { stats?: unknown }).stats) {
    return cached as { drafts: unknown[]; sent: unknown[]; stats: DashboardSendStats };
  }

  // Stats are unscoped to campaignId — they reflect the user's overall
  // sending workload, which is what the dashboard panel cares about.
  const statsPromise = readDashboardSendStats(userId, db);

  if (campaignId) {
    const where = { userLead: { userId, campaignLeads: { some: { campaignId } } } } as const;
    const [draftItems, sentItems, stats] = await Promise.all([
      db.email.findMany({ where: { ...where, status: "draft" }, take: 9, orderBy: { createdAt: "desc" }, include: emailInclude }),
      db.email.findMany({ where: { ...where, status: "sent" }, take: 21, orderBy: { createdAt: "desc" }, include: emailInclude }),
      statsPromise,
    ]);
    const result = {
      drafts: draftItems.slice(0, 8),
      sent: sentItems.slice(0, 20),
      stats,
    };
    setEmailDashboardCache(cacheKey, result);
    return result;
  }

  const branchWhere = (relation: "userLead" | "customContact", s: string) => ({ [relation]: { userId }, status: s });
  const [draftLeads, draftContacts, sentLeads, sentContacts, stats] = await Promise.all([
    db.email.findMany({ where: branchWhere("userLead", "draft"), take: 9, orderBy: { createdAt: "desc" }, include: emailInclude }),
    db.email.findMany({ where: branchWhere("customContact", "draft"), take: 9, orderBy: { createdAt: "desc" }, include: emailInclude }),
    db.email.findMany({ where: branchWhere("userLead", "sent"), take: 21, orderBy: { createdAt: "desc" }, include: emailInclude }),
    db.email.findMany({ where: branchWhere("customContact", "sent"), take: 21, orderBy: { createdAt: "desc" }, include: emailInclude }),
    statsPromise,
  ]);
  const result = {
    drafts: sortNewestFirst([...draftLeads, ...draftContacts]).slice(0, 8),
    sent: sortNewestFirst([...sentLeads, ...sentContacts]).slice(0, 20),
    stats,
  };
  setEmailDashboardCache(cacheKey, result);
  return result;
}

export async function listEmailQueue(userId: string, params: EmailQueueParams, db: Db = prisma) {
  const take = Math.min(params.limit || 50, 200);
  const { userLeadId, campaignId, status, cursor } = params;

  if (userLeadId) {
    const items = await db.email.findMany({
      where: { userLeadId, userLead: { userId }, ...(status && { status }) },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: "desc" },
      include: emailInclude,
    });
    return page(items, take);
  }

  if (campaignId) {
    const items = await db.email.findMany({
      where: {
        userLead: { userId, campaignLeads: { some: { campaignId } } },
        ...(status && { status }),
      },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: "desc" },
      include: emailInclude,
    });
    return page(items, take);
  }

  const branchWhere = (relation: "userLead" | "customContact") => ({
    [relation]: { userId },
    ...(status && { status }),
  });

  const [fromLeads, fromContacts] = await Promise.all([
    db.email.findMany({ where: branchWhere("userLead"), take: take + 1, orderBy: { createdAt: "desc" }, include: emailInclude }),
    db.email.findMany({ where: branchWhere("customContact"), take: take + 1, orderBy: { createdAt: "desc" }, include: emailInclude }),
  ]);

  return pageAfterCursor(sortNewestFirst([...fromLeads, ...fromContacts]), take, cursor);
}
