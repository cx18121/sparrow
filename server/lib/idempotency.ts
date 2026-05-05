import crypto from "node:crypto";
import { prisma } from "./prisma.js";
import { HttpError } from "./user.js";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 250;
const MAX_WAIT_MS = 30_000;

type State<T> =
  | { kind: "completed"; response: T }
  | { kind: "run" }
  | { kind: "wait" };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function hashRequest(value: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function sanitizeIdempotencyKey(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) return null;
  return trimmed;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function claimOrRead<T>(
  userId: string,
  key: string,
  requestHash: string,
  ttlMs: number,
  db: typeof prisma,
): Promise<State<T>> {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`idempotency:${userId}:${key}`}))`;
    await tx.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });

    const existing = await tx.idempotencyKey.findUnique({
      where: { userId_key: { userId, key } },
    });

    if (!existing) {
      await tx.idempotencyKey.create({
        data: {
          userId,
          key,
          requestHash,
          status: "processing",
          expiresAt: new Date(Date.now() + ttlMs),
        },
      });
      return { kind: "run" };
    }

    if (existing.requestHash !== requestHash) {
      throw new HttpError(409, "Idempotency key was already used for a different request.");
    }

    if (existing.status === "completed" && existing.response !== null) {
      return { kind: "completed", response: existing.response as T };
    }

    return { kind: "wait" };
  });
}

export async function runPersistentIdempotent<T>(params: {
  userId: string;
  key: string | null;
  requestHash: string;
  task: () => Promise<T>;
  ttlMs?: number;
  db?: typeof prisma;
}): Promise<T> {
  const { userId, key, requestHash, task, ttlMs = DEFAULT_TTL_MS, db = prisma } = params;
  if (!key) return task();

  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const state = await claimOrRead<T>(userId, key, requestHash, ttlMs, db);
    if (state.kind === "completed") return state.response;
    if (state.kind === "wait") {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    try {
      const response = await task();
      await db.idempotencyKey.update({
        where: { userId_key: { userId, key } },
        data: {
          status: "completed",
          response: response as any,
          expiresAt: new Date(Date.now() + ttlMs),
        },
      });
      return response;
    } catch (err) {
      await db.idempotencyKey.delete({ where: { userId_key: { userId, key } } }).catch(() => {});
      throw err;
    }
  }

  throw new HttpError(409, "This request is still processing. Try again in a moment.");
}
