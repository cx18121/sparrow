import { prisma } from "./prisma.js";
import { parseBatchSize, parseNullableBoolean, parseNullableNumber } from "./parse-params.js";
import { HttpError } from "./user.js";

export const CAMPAIGN_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const LEGACY_STATUS_COERCE: Record<string, CampaignStatus> = { DRAFT: "PAUSED" };

const campaignInclude = {
  template: { select: { id: true, name: true } },
};

export function coerceLegacyCampaignStatus<T extends { status: string }>(row: T): T {
  return LEGACY_STATUS_COERCE[row.status]
    ? ({ ...row, status: LEGACY_STATUS_COERCE[row.status] } as T)
    : row;
}

function requireWriteStatus(value: unknown): CampaignStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && CAMPAIGN_STATUSES.includes(value as CampaignStatus)) {
    return value as CampaignStatus;
  }
  throw new HttpError(400, `status must be one of ${CAMPAIGN_STATUSES.join(", ")}`);
}

async function resolveTemplateId(templateId: unknown, userId: string): Promise<string | null> {
  if (!templateId) return null;
  if (typeof templateId !== "string") return null;
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    select: { id: true, userId: true, isShared: true },
  });
  if (!template || (template.userId !== userId && !template.isShared)) {
    throw new HttpError(404, "Template not found");
  }
  return template.id;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export async function listCampaignDefinitions(userId: string, status?: string) {
  const allowedStatus =
    status && CAMPAIGN_STATUSES.includes(status as CampaignStatus)
      ? (status as CampaignStatus)
      : undefined;

  const items = await prisma.campaign.findMany({
    where: {
      userId,
      ...(allowedStatus && { status: allowedStatus }),
    },
    orderBy: { updatedAt: "desc" },
    include: campaignInclude,
  });

  return items.map(coerceLegacyCampaignStatus);
}

export async function createCampaignDefinition(userId: string, body: Record<string, unknown> | null) {
  const {
    name, subject, status, templateId, scheduledAt,
    filterTags, filterRegion, filterStage, filterBatch, filterIsHiring,
    filterHeadcountMin, filterHeadcountMax, batchSize, tone, attachmentIds,
    includePreviouslySaved,
  } = body ?? {};

  if (!name) throw new HttpError(400, "name is required");
  const writeStatus = requireWriteStatus(status) ?? "ACTIVE";
  const ownedTemplateId = await resolveTemplateId(templateId, userId);

  return prisma.campaign.create({
    data: {
      userId,
      name: name as string,
      subject: (subject as string | null) ?? null,
      status: writeStatus,
      templateId: ownedTemplateId,
      scheduledAt: scheduledAt ? new Date(scheduledAt as string) : null,
      filterTags: Array.isArray(filterTags) ? (filterTags as string[]) : [],
      filterRegion: (filterRegion as string | null) ?? null,
      filterStage: (filterStage as string | null) ?? null,
      filterBatch: (filterBatch as string | null) ?? null,
      filterIsHiring: parseNullableBoolean(filterIsHiring),
      filterHeadcountMin: parseNullableNumber(filterHeadcountMin),
      filterHeadcountMax: parseNullableNumber(filterHeadcountMax),
      batchSize: parseBatchSize(batchSize),
      tone: (tone as string | null) ?? null,
      attachmentIds: stringArray(attachmentIds),
      includePreviouslySaved: typeof includePreviouslySaved === "boolean" ? includePreviouslySaved : false,
    },
    include: campaignInclude,
  });
}

export async function updateCampaignDefinition(userId: string, body: Record<string, unknown> | null) {
  const {
    id, name, subject, status, templateId, scheduledAt,
    filterTags, filterRegion, filterStage, filterBatch, filterIsHiring,
    filterHeadcountMin, filterHeadcountMax, batchSize, tone, attachmentIds,
    includePreviouslySaved,
  } = body ?? {};

  if (!id) throw new HttpError(400, "id is required");
  const existing = await prisma.campaign.findUnique({ where: { id: id as string } });
  if (!existing || existing.userId !== userId) throw new HttpError(404, "Campaign not found");

  const writeStatus = requireWriteStatus(status);
  const ownedTemplateId = templateId !== undefined
    ? await resolveTemplateId(templateId, userId)
    : undefined;

  return prisma.campaign.update({
    where: { id: id as string },
    data: {
      ...(name !== undefined && { name: name as string }),
      ...(subject !== undefined && { subject: subject as string | null }),
      ...(writeStatus !== undefined && { status: writeStatus }),
      ...(templateId !== undefined && { templateId: ownedTemplateId }),
      ...(scheduledAt !== undefined && {
        scheduledAt: scheduledAt ? new Date(scheduledAt as string) : null,
      }),
      ...(filterTags !== undefined && { filterTags: Array.isArray(filterTags) ? (filterTags as string[]) : [] }),
      ...(filterRegion !== undefined && { filterRegion: (filterRegion as string | null) ?? null }),
      ...(filterStage !== undefined && { filterStage: (filterStage as string | null) ?? null }),
      ...(filterBatch !== undefined && { filterBatch: (filterBatch as string | null) ?? null }),
      ...(filterIsHiring !== undefined && { filterIsHiring: parseNullableBoolean(filterIsHiring) }),
      ...(filterHeadcountMin !== undefined && { filterHeadcountMin: parseNullableNumber(filterHeadcountMin) }),
      ...(filterHeadcountMax !== undefined && { filterHeadcountMax: parseNullableNumber(filterHeadcountMax) }),
      ...(batchSize !== undefined && { batchSize: parseBatchSize(batchSize) }),
      ...(tone !== undefined && { tone: (tone as string | null) ?? null }),
      ...(attachmentIds !== undefined && { attachmentIds: stringArray(attachmentIds) }),
      ...(includePreviouslySaved !== undefined && {
        includePreviouslySaved: typeof includePreviouslySaved === "boolean" ? includePreviouslySaved : false,
      }),
    },
    include: campaignInclude,
  });
}

export async function deleteCampaignDefinition(userId: string, id: string | undefined) {
  if (!id) throw new HttpError(400, "id query param is required");
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) throw new HttpError(404, "Campaign not found");
  await prisma.campaign.delete({ where: { id } });
}
