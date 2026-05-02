// HttpError — used by route handlers for typed HTTP errors.
// Auth is handled by getUserIdFromRequest() in supabaseAdmin.ts (JWT verified).
// Do NOT add x-user-id-based helpers here; they bypass JWT verification.
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
