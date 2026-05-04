import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {},
}));

import { checkEmailSendQuota, consumeDurableDailyQuota, QuotaError } from "../lib/rate-limit.js";

describe("consumeDurableDailyQuota", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T15:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates or increments the quota row for today's UTC date", async () => {
    const db = {
      dailyQuota: {
        upsert: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await consumeDurableDailyQuota("apollo", "user-1", "reveal", 5, db as any);

    expect(db.dailyQuota.upsert).toHaveBeenCalledWith({
      where: {
        scope_subjectId_action_day: {
          scope: "apollo",
          subjectId: "user-1",
          action: "reveal",
          day: "2026-05-04",
        },
      },
      create: { scope: "apollo", subjectId: "user-1", action: "reveal", day: "2026-05-04", count: 1 },
      update: { count: { increment: 1 } },
    });
  });

  it("throws when the durable quota count exceeds the normalized limit", async () => {
    const db = {
      dailyQuota: {
        upsert: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };

    await expect(consumeDurableDailyQuota("apollo", "user-1", "reveal", Number.NaN, db as any)).rejects.toThrow(
      new QuotaError("Daily reveal limit reached (1). Try again tomorrow."),
    );
  });

  it("rounds finite limits and enforces a minimum of one", async () => {
    const db = {
      dailyQuota: {
        upsert: vi.fn().mockResolvedValue({ count: 4 }),
      },
    };

    await expect(consumeDurableDailyQuota("apollo", "user-1", "reveal", 3.4, db as any)).rejects.toThrow(
      "Daily reveal limit reached (3). Try again tomorrow.",
    );
  });
});

describe("checkEmailSendQuota", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T15:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts sent emails for both lead and custom-contact recipients since UTC midnight", async () => {
    const db = {
      email: {
        count: vi.fn().mockResolvedValue(3),
      },
    };

    await checkEmailSendQuota("user-1", 10, db as any);

    expect(db.email.count).toHaveBeenCalledWith({
      where: {
        status: "sent",
        sentAt: { gte: new Date("2026-05-04T00:00:00.000Z") },
        OR: [{ userLead: { userId: "user-1" } }, { customContact: { userId: "user-1" } }],
      },
    });
  });

  it("throws when the user is already at the daily send limit", async () => {
    const db = {
      email: {
        count: vi.fn().mockResolvedValue(10),
      },
    };

    await expect(checkEmailSendQuota("user-1", 10, db as any)).rejects.toThrow(
      "Daily send limit reached (10/10). Try again tomorrow.",
    );
  });
});
