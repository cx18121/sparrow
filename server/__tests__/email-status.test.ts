import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {},
}));

import { claimForSending, isAllowedStatus, markFailed, markSent } from "../lib/email-status.js";

describe("email status helpers", () => {
  it("allows only client-visible email statuses", () => {
    expect(isAllowedStatus("draft")).toBe(true);
    expect(isAllowedStatus("sent")).toBe(true);
    expect(isAllowedStatus("failed")).toBe(true);
    expect(isAllowedStatus("sending")).toBe(false);
    expect(isAllowedStatus("queued")).toBe(false);
  });

  it("claims only sendable drafts and failed emails", async () => {
    const db = {
      email: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await expect(claimForSending("email-1", db as any)).resolves.toBe(true);
    expect(db.email.updateMany).toHaveBeenCalledWith({
      where: { id: "email-1", status: { in: ["draft", "failed"] } },
      data: { status: "sending" },
    });
  });

  it("returns false when no email row is claimed", async () => {
    const db = {
      email: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    await expect(claimForSending("email-1", db as any)).resolves.toBe(false);
  });

  it("marks emails sent with a sent timestamp", async () => {
    const db = {
      email: {
        update: vi.fn().mockResolvedValue({ id: "email-1", status: "sent" }),
      },
    };

    await markSent("email-1", db as any);

    expect(db.email.update).toHaveBeenCalledOnce();
    expect(db.email.update.mock.calls[0][0].where).toEqual({ id: "email-1" });
    expect(db.email.update.mock.calls[0][0].data.status).toBe("sent");
    expect(db.email.update.mock.calls[0][0].data.sentAt).toBeInstanceOf(Date);
  });

  it("marks emails failed", async () => {
    const db = {
      email: {
        update: vi.fn().mockResolvedValue({ id: "email-1", status: "failed" }),
      },
    };

    await markFailed("email-1", db as any);

    expect(db.email.update).toHaveBeenCalledWith({
      where: { id: "email-1" },
      data: { status: "failed" },
    });
  });
});
