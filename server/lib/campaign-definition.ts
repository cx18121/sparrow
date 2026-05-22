import { prisma } from "./prisma.js";
import { parseBatchSize, parseNullableBoolean } from "./parse-params.js";
import { HttpError } from "./user.js";
import { normalizeRoleFamily } from "../../src/types/roleFamilies.js";

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

// Accept the array shape from current clients and the legacy scalar shape
// from any pre-multi-select callers that haven't shipped yet. Empty string
// scalars become [] (mirrors how the wizard treated "" as "no filter").
function filterStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
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
    include: {
      ...campaignInclude,
      // Lead count is the natural _count of CampaignLead rows.
      _count: { select: { leads: true } },
    },
  });

  if (items.length === 0) return [];

  // Draft / sent counts: Email rows aren't pinned to a Campaign directly —
  // they hang off UserLead, which joins to Campaign through CampaignLead.
  // One grouped raw query covers all of the user's campaigns in a single
  // round-trip; matches the same email-belongs-to-multi-campaigns join that
  // readDashboardEmailQueue uses inside the workspace, so Home counts agree
  // with what the user sees once they open a campaign.
  const campaignIds = items.map(c => c.id);
  const emailCounts = await prisma.$queryRaw<
    Array<{ campaignId: string; draftCount: bigint; sentCount: bigint }>
  >`
    SELECT
      cl."campaignId" AS "campaignId",
      COUNT(*) FILTER (WHERE e.status = 'draft')::bigint AS "draftCount",
      COUNT(*) FILTER (WHERE e.status = 'sent')::bigint AS "sentCount"
    FROM "CampaignLead" cl
    LEFT JOIN "Email" e ON e."userLeadId" = cl."userLeadId"
    WHERE cl."campaignId" = ANY(${campaignIds}::text[])
    GROUP BY cl."campaignId"
  `;
  const countsById = new Map(
    emailCounts.map(r => [r.campaignId, { drafts: Number(r.draftCount), sent: Number(r.sentCount) }])
  );

  return items.map(coerceLegacyCampaignStatus).map(item => {
    const ec = countsById.get(item.id) ?? { drafts: 0, sent: 0 };
    // Strip the _count field from the response shape — we re-expose the
    // numbers as flat top-level fields so the API type stays clean.
    const { _count, ...rest } = item;
    return {
      ...rest,
      leadCount: _count.leads,
      draftCount: ec.drafts,
      sentCount: ec.sent,
    };
  });
}

export async function createCampaignDefinition(userId: string, body: Record<string, unknown> | null) {
  const {
    name, subject, status, templateId, scheduledAt,
    filterTags, filterRegion, filterStage, filterBatch, filterIsHiring,
    filterTargetRole,
    batchSize, tone, attachmentIds,
    includePreviouslySaved,
  } = body ?? {};

  if (!name) throw new HttpError(400, "name is required");

  const nameClash = await prisma.campaign.findFirst({
    where: { userId, name: { equals: (name as string).trim(), mode: 'insensitive' } },
    select: { id: true },
  })
  if (nameClash) throw new HttpError(409, "A campaign with that name already exists.")

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
      filterRegion: filterStringArray(filterRegion),
      filterStage: filterStringArray(filterStage),
      filterBatch: filterStringArray(filterBatch),
      filterIsHiring: parseNullableBoolean(filterIsHiring),
      // Gate through normalizeRoleFamily so an unknown id (typo, deprecated
      // family from before the 6→4 consolidation, junk from a patched
      // client) lands in the DB as null instead of silently corrupting
      // future Apollo queries for this campaign.
      filterTargetRole: normalizeRoleFamily(filterTargetRole, { fallback: null }),
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
    filterTargetRole,
    batchSize, tone, attachmentIds,
    includePreviouslySaved,
  } = body ?? {};

  if (!id) throw new HttpError(400, "id is required");
  const existing = await prisma.campaign.findUnique({ where: { id: id as string } });
  if (!existing || existing.userId !== userId) throw new HttpError(404, "Campaign not found");

  if (name !== undefined) {
    const nameClash = await prisma.campaign.findFirst({
      where: { userId, name: { equals: (name as string).trim(), mode: 'insensitive' }, NOT: { id: id as string } },
      select: { id: true },
    })
    if (nameClash) throw new HttpError(409, "A campaign with that name already exists.")
  }

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
      ...(filterRegion !== undefined && { filterRegion: filterStringArray(filterRegion) }),
      ...(filterStage !== undefined && { filterStage: filterStringArray(filterStage) }),
      ...(filterBatch !== undefined && { filterBatch: filterStringArray(filterBatch) }),
      ...(filterIsHiring !== undefined && { filterIsHiring: parseNullableBoolean(filterIsHiring) }),
      ...(filterTargetRole !== undefined && {
        // Same normalization as create — bad ids in PATCH bodies must not
        // corrupt the DB. See create branch above for rationale.
        filterTargetRole: normalizeRoleFamily(filterTargetRole, { fallback: null }),
      }),
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
