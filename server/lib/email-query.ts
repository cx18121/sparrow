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
      company: { select: { id: true, name: true, domain: true } },
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

export async function countEmailsSentToday(userId: string, db: Db = prisma) {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const [fromLeads, fromContacts] = await Promise.all([
    db.email.count({ where: { status: "sent", sentAt: { gte: startOfToday }, userLead: { userId } } }),
    db.email.count({ where: { status: "sent", sentAt: { gte: startOfToday }, customContact: { userId } } }),
  ]);
  return { count: fromLeads + fromContacts };
}

export async function readDashboardEmailQueue(
  userId: string,
  params: { campaignId?: string } = {},
  db: Db = prisma,
) {
  const { campaignId } = params;
  const cacheKey = emailDashboardCacheKey(userId, campaignId);
  const cached = getEmailDashboardCache(cacheKey);
  if (cached) return cached as { drafts: unknown[]; sent: unknown[] };

  if (campaignId) {
    const where = { userLead: { userId, campaignLeads: { some: { campaignId } } } } as const;
    const [draftItems, sentItems] = await Promise.all([
      db.email.findMany({ where: { ...where, status: "draft" }, take: 9, orderBy: { createdAt: "desc" }, include: emailInclude }),
      db.email.findMany({ where: { ...where, status: "sent" }, take: 21, orderBy: { createdAt: "desc" }, include: emailInclude }),
    ]);
    const result = {
      drafts: draftItems.slice(0, 8),
      sent: sentItems.slice(0, 20),
    };
    setEmailDashboardCache(cacheKey, result);
    return result;
  }

  const branchWhere = (relation: "userLead" | "customContact", s: string) => ({ [relation]: { userId }, status: s });
  const [draftLeads, draftContacts, sentLeads, sentContacts] = await Promise.all([
    db.email.findMany({ where: branchWhere("userLead", "draft"), take: 9, orderBy: { createdAt: "desc" }, include: emailInclude }),
    db.email.findMany({ where: branchWhere("customContact", "draft"), take: 9, orderBy: { createdAt: "desc" }, include: emailInclude }),
    db.email.findMany({ where: branchWhere("userLead", "sent"), take: 21, orderBy: { createdAt: "desc" }, include: emailInclude }),
    db.email.findMany({ where: branchWhere("customContact", "sent"), take: 21, orderBy: { createdAt: "desc" }, include: emailInclude }),
  ]);
  const result = {
    drafts: sortNewestFirst([...draftLeads, ...draftContacts]).slice(0, 8),
    sent: sortNewestFirst([...sentLeads, ...sentContacts]).slice(0, 20),
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

  return page(sortNewestFirst([...fromLeads, ...fromContacts]).slice(0, take + 1), take);
}
