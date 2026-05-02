import { HttpError } from "./user.js";

export function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, "Invalid numeric value");
  return parsed;
}

export function parseBatchSize(value: unknown): number {
  const parsed = value == null || value === "" ? 10 : Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, "Invalid batch size");
  return Math.min(Math.max(parsed, 1), 50);
}

export function parseNullableBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new HttpError(400, "Invalid boolean value");
}

export function parseBody(req: { body?: unknown }): Record<string, unknown> | null {
  if (!req.body) return null;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return req.body as Record<string, unknown>;
}
