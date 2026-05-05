import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../../lib/supabaseAdmin.js";
import { generateDraft, GenerationError, ProfileError } from "../../lib/draft-generation.js";
import { parseBody } from "../../lib/parse-params.js";
import { sendRouteError } from "../../lib/route-error.js";
import { hashRequest, runPersistentIdempotent, sanitizeIdempotencyKey } from "../../lib/idempotency.js";

function readIdempotencyKey(req: VercelRequest) {
  const raw = req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return sanitizeIdempotencyKey(value);
}

function generationIdempotencyKey(params: {
  headerKey: string | null;
  save: unknown;
  userLeadId: unknown;
  customContactId: unknown;
  templateId: unknown;
  attachmentIds: unknown;
}) {
  if (params.save === true) {
    const target = params.userLeadId
      ? `lead:${params.userLeadId}`
      : params.customContactId
      ? `custom:${params.customContactId}`
      : null;
    if (target) {
      return `draft-save:${target}:template:${params.templateId ?? "none"}:attachments:${hashRequest(params.attachmentIds ?? [])}`;
    }
  }
  return params.headerKey;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const body = parseBody(req) ?? {};
    const { userLeadId, customContactId, templateId, attachmentIds, interestHook, tone, extraContext, includeResumeBullet, save } = body as Record<string, unknown>;

    if (!userLeadId && !customContactId) {
      return res.status(400).json({ error: "userLeadId or customContactId is required" });
    }

    const idempotencyKey = generationIdempotencyKey({
      headerKey: readIdempotencyKey(req),
      save,
      userLeadId,
      customContactId,
      templateId,
      attachmentIds,
    });
    const requestHash = hashRequest({ userLeadId, customContactId, templateId, attachmentIds, interestHook, tone, extraContext, includeResumeBullet, save });

    const result = await runPersistentIdempotent({
      userId,
      key: idempotencyKey,
      requestHash,
      task: () => generateDraft({
      userId,
      userLeadId: userLeadId as string | undefined,
      customContactId: customContactId as string | undefined,
      templateId: templateId as string | null | undefined,
      attachmentIds: Array.isArray(attachmentIds) ? attachmentIds.filter((id): id is string => typeof id === "string") : undefined,
      interestHook: interestHook as string | null | undefined,
      tone: tone as string | null | undefined,
      extraContext: extraContext as string | null | undefined,
      includeResumeBullet: includeResumeBullet as boolean | undefined,
      save: save as boolean | undefined,
      }),
    });
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof GenerationError) return res.status(err.status).json({ error: err.message });
    if (err instanceof ProfileError) return res.status(err.status).json({ error: err.message });
    return sendRouteError(res, err, "Could not generate email");
  }
}
