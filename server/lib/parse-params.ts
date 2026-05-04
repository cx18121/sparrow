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

// Page size for list endpoints: defaults to 50 when missing or
// unparseable (no exception — paginated reads should never 400 because
// the user clicked a stale link). Clamped to [1, 200].
export function parsePageSize(value: unknown): number {
  if (value === undefined || value === null || value === "") return 50;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
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
    try {
      return JSON.parse(req.body);
    } catch {
      // Malformed JSON is a client mistake — surface it as a typed 400 so
      // every route's existing try/catch + sendRouteError emits a clean
      // { error: "Invalid JSON body" } instead of falling through to the
      // generic "field X is required" message that misleads the caller.
      throw new HttpError(400, "Invalid JSON body");
    }
  }
  return req.body as Record<string, unknown>;
}
