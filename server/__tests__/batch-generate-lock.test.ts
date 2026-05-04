import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug 10H: Batch.generate must acquire pg_advisory_xact_lock so concurrent
// generations on the same campaign serialize. This test pins that
// behaviour: every code path through generate() goes through $transaction
// and the first thing the txn does is take the advisory lock.

const { mockPrisma, mockTx } = vi.hoisted(() => {
  const mockTx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    campaign: { findUnique: vi.fn(), update: vi.fn() },
    campaignSeenCompany: { findMany: vi.fn(), createMany: vi.fn() },
    campaignLead: { findMany: vi.fn(), upsert: vi.fn() },
    company: { findMany: vi.fn() },
    userLead: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    contact: { upsert: vi.fn() },
    dailyQuota: { upsert: vi.fn() },
  };
  const mockPrisma = {
    $transaction: vi.fn(async (cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
  };
  return { mockPrisma, mockTx };
});

vi.mock("../lib/prisma.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../scripts/_lib/region-map.js", () => ({
  US_REGIONS: ["CA", "NY", "TX"],
}));

import { Batch } from "../lib/batch.js";

const CAMPAIGN_ID = "cmp-locked";
const USER_ID = "user-1";

describe("Batch.generate — advisory lock (bug 10H)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockTx) => unknown) => cb(mockTx));
  });

  it("opens a $transaction and acquires the advisory lock before any other DB work", async () => {
    // Minimum mocks for an early-return generate (zero candidate companies):
    mockTx.campaign.findUnique.mockResolvedValue({
      id: CAMPAIGN_ID, userId: USER_ID, currentBatch: 0, batchSize: 10,
      filterTags: [], filterRegion: null, filterStage: null, filterBatch: null,
      filterIsHiring: null, filterHeadcountMin: null, filterHeadcountMax: null,
      includePreviouslySaved: false,
    });
    mockTx.campaignSeenCompany.findMany.mockResolvedValue([]);
    mockTx.campaignLead.findMany.mockResolvedValue([]);
    mockTx.company.findMany.mockResolvedValue([]); // no candidates → early return

    await Batch.generate(CAMPAIGN_ID, USER_ID, null);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
    // The first $executeRaw inside the txn must be the lock acquisition.
    // The tagged-template form passes a TemplateStringsArray; we assert the
    // SQL fragments include pg_advisory_xact_lock + hashtext.
    const callArgs = mockTx.$executeRaw.mock.calls[0];
    const sql = (callArgs[0] as readonly string[]).join("?");
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/hashtext/);
    // The campaignId is passed as the parameter so the lock key is per-campaign.
    expect(callArgs.slice(1)).toContain(CAMPAIGN_ID);
  });

  it("returns 404 (HttpError) when the campaign isn't owned by the user — still inside the lock", async () => {
    mockTx.campaign.findUnique.mockResolvedValue({ id: CAMPAIGN_ID, userId: "someone-else", currentBatch: 0, batchSize: 10 });
    await expect(Batch.generate(CAMPAIGN_ID, USER_ID, null)).rejects.toMatchObject({ status: 404 });
    // Lock was still acquired before the ownership check.
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
