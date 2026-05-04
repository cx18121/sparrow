import { prisma, type Db } from "./prisma.js";

export type EmailStatus = "draft" | "sending" | "sent" | "failed";

// Statuses clients may set or filter by. "sending" is internal-only.
export const ALLOWED_EMAIL_STATUSES = ["draft", "sent", "failed"] as const;

// Statuses from which a send attempt is legal.
export const SENDABLE_STATUSES = ["draft", "failed"] as const;

export function isAllowedStatus(s: string): s is EmailStatus {
  return (ALLOWED_EMAIL_STATUSES as readonly string[]).includes(s);
}

// Atomically claims a draft for sending. Returns true only if exactly one row
// transitioned to "sending" — prevents double-sends under concurrent requests.
export async function claimForSending(emailId: string, db: Db = prisma): Promise<boolean> {
  const result = await db.email.updateMany({
    where: { id: emailId, status: { in: [...SENDABLE_STATUSES] } },
    data: { status: "sending" },
  });
  return result.count === 1;
}

export async function markSent(emailId: string, db: Db = prisma) {
  return db.email.update({
    where: { id: emailId },
    data: { status: "sent", sentAt: new Date() },
  });
}

export async function markFailed(emailId: string, db: Db = prisma): Promise<void> {
  await db.email.update({ where: { id: emailId }, data: { status: "failed" } });
}
