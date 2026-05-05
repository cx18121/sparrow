import { prisma } from "./prisma.js";
import { HttpError } from "./user.js";

export const campaignLeadUserLeadInclude = {
  userLead: {
    include: {
      company: {
        select: {
          id: true, name: true, domain: true, oneLiner: true,
          industry: true, region: true, stage: true, batch: true, isHiring: true,
        },
      },
      contact: { select: { id: true, name: true, email: true, title: true } },
      emails: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: { id: true, subject: true, status: true },
      },
    },
  },
};

const customContactInclude = {
  customContact: {
    include: {
      emails: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: { id: true, subject: true, status: true },
      },
    },
  },
};

export function serializeCampaignLead(row: {
  id: string;
  batchNumber: number;
  userLead: Record<string, unknown>;
}) {
  return { ...row.userLead, campaignLeadId: row.id, batchNumber: row.batchNumber };
}

export function serializeCampaignCustomContact(row: {
  id: string;
  customContact: Record<string, unknown>;
}) {
  return { ...row.customContact, campaignCustomContactId: row.id };
}

async function requireCampaign(campaignId: string, userId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, userId: true },
  });
  if (!campaign || campaign.userId !== userId) throw new HttpError(404, "Campaign not found");
  return campaign;
}

export async function listCampaignMembers(campaignId: string | undefined, userId: string) {
  if (!campaignId) throw new HttpError(400, "campaignId is required");
  await requireCampaign(campaignId, userId);

  const [leadRows, customRows] = await Promise.all([
    prisma.campaignLead.findMany({
      where: { campaignId },
      orderBy: [{ batchNumber: "asc" }, { createdAt: "desc" }],
      include: campaignLeadUserLeadInclude,
    }),
    prisma.campaignCustomContact.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
      include: customContactInclude,
    }),
  ]);

  return {
    items: leadRows.map(serializeCampaignLead),
    customContacts: customRows.map(serializeCampaignCustomContact),
  };
}

export async function attachCustomContactToCampaign(
  campaignId: string,
  customContactId: string,
  userId: string,
) {
  await requireCampaign(campaignId, userId);
  const contact = await prisma.customContact.findUnique({ where: { id: customContactId } });
  if (!contact || contact.userId !== userId) throw new HttpError(404, "Contact not found");

  const existing = await prisma.campaignCustomContact.findUnique({
    where: { campaignId_customContactId: { campaignId, customContactId } },
  });
  if (existing) return existing;

  return prisma.campaignCustomContact.create({
    data: { campaignId, customContactId },
  });
}

export async function removeCampaignCustomContact(id: string | undefined, userId: string) {
  if (!id) throw new HttpError(400, "id query param is required");

  const row = await prisma.campaignCustomContact.findUnique({
    where: { id },
    include: { campaign: { select: { userId: true } } },
  });
  if (!row || row.campaign.userId !== userId) {
    throw new HttpError(404, "Campaign contact not found");
  }

  await prisma.campaignCustomContact.delete({ where: { id } });
}

export async function addCampaignMember(body: Record<string, unknown> | null, userId: string) {
  const { campaignId, userLeadId } = body ?? {};
  if (!campaignId) throw new HttpError(400, "campaignId is required");
  if (!userLeadId) throw new HttpError(400, "userLeadId is required");

  await requireCampaign(campaignId as string, userId);
  const lead = await prisma.userLead.findUnique({ where: { id: userLeadId as string } });
  if (!lead || lead.userId !== userId) throw new HttpError(404, "Lead not found");

  const existing = await prisma.campaignLead.findFirst({
    where: { campaignId: campaignId as string, userLeadId: userLeadId as string },
    include: campaignLeadUserLeadInclude,
  });
  if (existing) return { item: serializeCampaignLead(existing), created: false };

  const row = await prisma.campaignLead.create({
    data: { campaignId: campaignId as string, userLeadId: userLeadId as string, batchNumber: 0 },
    include: campaignLeadUserLeadInclude,
  });

  return { item: serializeCampaignLead(row), created: true };
}

export async function removeCampaignMember(id: string | undefined, userId: string) {
  if (!id) throw new HttpError(400, "id query param is required");

  const row = await prisma.campaignLead.findUnique({
    where: { id },
    include: { campaign: { select: { userId: true } } },
  });
  if (!row || row.campaign.userId !== userId) {
    throw new HttpError(404, "Campaign company not found");
  }

  await prisma.campaignLead.delete({ where: { id } });
}
