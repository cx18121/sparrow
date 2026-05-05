import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    email: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return { mockPrisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

import {
  countEmailsSentToday,
  listEmailQueue,
  readDashboardEmailQueue,
} from "../lib/email-query.js";

const USER_ID = "user-email-query";

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & {
    __dashCache?: Map<string, { data: unknown; ts: number }>;
  }).__dashCache = new Map();
});

describe("countEmailsSentToday", () => {
  it("counts sent Lead and Custom Contact emails since UTC midnight", async () => {
    mockPrisma.email.count.mockResolvedValueOnce(2).mockResolvedValueOnce(3);

    await expect(countEmailsSentToday(USER_ID)).resolves.toEqual({ count: 5 });

    expect(mockPrisma.email.count).toHaveBeenCalledWith({
      where: { status: "sent", sentAt: { gte: expect.any(Date) }, userLead: { userId: USER_ID } },
    });
    expect(mockPrisma.email.count).toHaveBeenCalledWith({
      where: { status: "sent", sentAt: { gte: expect.any(Date) }, customContact: { userId: USER_ID } },
    });
  });
});

describe("readDashboardEmailQueue", () => {
  it("reads campaign-scoped Drafts and Sent from Lead emails only", async () => {
    const draft = { id: "draft-1", createdAt: new Date("2026-01-02") };
    const sent = { id: "sent-1", createdAt: new Date("2026-01-01") };
    mockPrisma.email.findMany.mockResolvedValueOnce([draft]).mockResolvedValueOnce([sent]);

    await expect(readDashboardEmailQueue(USER_ID, { campaignId: "campaign-1" })).resolves.toEqual({
      drafts: [draft],
      sent: [sent],
    });

    expect(mockPrisma.email.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.email.findMany.mock.calls[0][0].where).toMatchObject({
      userLead: { userId: USER_ID, campaignLeads: { some: { campaignId: "campaign-1" } } },
      status: "draft",
    });
    expect(mockPrisma.email.findMany.mock.calls[0][0].where).not.toHaveProperty("customContact");
  });

  it("merges global Lead and Custom Contact Drafts/Sent by createdAt", async () => {
    const olderDraft = { id: "draft-lead", createdAt: new Date("2026-01-01") };
    const newerDraft = { id: "draft-custom", createdAt: new Date("2026-01-03") };
    const newerSent = { id: "sent-lead", createdAt: new Date("2026-01-04") };
    const olderSent = { id: "sent-custom", createdAt: new Date("2026-01-02") };
    mockPrisma.email.findMany
      .mockResolvedValueOnce([olderDraft])
      .mockResolvedValueOnce([newerDraft])
      .mockResolvedValueOnce([newerSent])
      .mockResolvedValueOnce([olderSent]);

    await expect(readDashboardEmailQueue(USER_ID, {})).resolves.toEqual({
      drafts: [newerDraft, olderDraft],
      sent: [newerSent, olderSent],
    });
  });

  it("serves warm dashboard reads from cache", async () => {
    const cached = { drafts: [{ id: "cached-draft" }], sent: [] };
    (globalThis as typeof globalThis & {
      __dashCache?: Map<string, { data: unknown; ts: number }>;
    }).__dashCache!.set(`${USER_ID}:global`, { data: cached, ts: Date.now() });

    await expect(readDashboardEmailQueue(USER_ID, {})).resolves.toEqual(cached);
    expect(mockPrisma.email.findMany).not.toHaveBeenCalled();
  });
});

describe("listEmailQueue", () => {
  it("returns cursor pagination for campaign-scoped Drafts", async () => {
    const first = { id: "email-1", createdAt: new Date("2026-01-02") };
    const second = { id: "email-2", createdAt: new Date("2026-01-01") };
    mockPrisma.email.findMany.mockResolvedValueOnce([first, second]);

    await expect(listEmailQueue(USER_ID, {
      campaignId: "campaign-1",
      status: "draft",
      limit: 1,
      cursor: "cursor-email",
    })).resolves.toEqual({ items: [first], nextCursor: "email-1" });

    expect(mockPrisma.email.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userLead: { userId: USER_ID, campaignLeads: { some: { campaignId: "campaign-1" } } },
        status: "draft",
      },
      take: 2,
      cursor: { id: "cursor-email" },
      skip: 1,
    }));
  });

  it("applies cursor pagination after merging the global queue", async () => {
    const contactNewer = { id: "contact-newer", createdAt: new Date("2026-01-03") };
    const leadCursor = { id: "lead-cursor", createdAt: new Date("2026-01-02") };
    const leadOlder = { id: "lead-older", createdAt: new Date("2026-01-01") };
    mockPrisma.email.findMany.mockResolvedValueOnce([leadCursor, leadOlder]).mockResolvedValueOnce([contactNewer]);

    await expect(listEmailQueue(USER_ID, {
      status: "draft",
      limit: 1,
      cursor: "lead-cursor",
    })).resolves.toEqual({ items: [leadOlder], nextCursor: null });
  });
});
