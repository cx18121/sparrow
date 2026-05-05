import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../../lib/supabaseAdmin.js";
import { generateDraft, GenerationError, ProfileError } from "../../lib/draft-generation.js";
import { parseBody } from "../../lib/parse-params.js";
import { sendRouteError } from "../../lib/route-error.js";

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const idempotencyCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();

function readIdempotencyKey(req: VercelRequest) {
  const raw = req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 160 ? trimmed : null;
}

function runIdempotent<T>(userId: string, key: string | null, task: () => Promise<T>): Promise<T> {
  if (!key) return task();

  const now = Date.now();
  const cacheKey = `${userId}:${key}`;
  for (const [entryKey, entry] of idempotencyCache) {
    if (entry.expiresAt <= now) idempotencyCache.delete(entryKey);
  }

  const existing = idempotencyCache.get(cacheKey);
  if (existing && existing.expiresAt > now) return existing.promise as Promise<T>;

  const promise = task().catch(err => {
    idempotencyCache.delete(cacheKey);
    throw err;
  });
  idempotencyCache.set(cacheKey, { expiresAt: now + IDEMPOTENCY_TTL_MS, promise });
  return promise;
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

    const result = await runIdempotent(userId, readIdempotencyKey(req), () => generateDraft({
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
    }));
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof GenerationError) return res.status(err.status).json({ error: err.message });
    if (err instanceof ProfileError) return res.status(err.status).json({ error: err.message });
    return sendRouteError(res, err, "Could not generate email");
  }
}
