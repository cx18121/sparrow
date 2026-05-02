import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    campaignLead: {
      findMany: vi.fn(),
    },
    company: {
      findMany: vi.fn(),
    },
  };
  return { mockPrisma };
});

vi.mock("../lib/prisma.js", () => ({
  prisma: mockPrisma,
}));

// Stub region-map so the module loads without the real script dependency
vi.mock("../../scripts/_lib/region-map.js", () => ({
  US_REGIONS: ["CA", "NY", "TX"],
}));

import { buildTagFilters, selectCandidateIds } from "../lib/campaign-batch-service.js";

// ---------------------------------------------------------------------------
// buildTagFilters
// ---------------------------------------------------------------------------

describe("buildTagFilters", () => {
  it("returns empty array for empty input", () => {
    expect(buildTagFilters([])).toEqual([]);
  });

  it("returns a single hasSome clause for a single tag", () => {
    const result = buildTagFilters(["stage:Seed"]);
    expect(result).toEqual([{ tags: { hasSome: ["stage:Seed"] } }]);
  });

  it("groups tags by namespace: different namespaces produce AND clauses (one per namespace)", () => {
    const result = buildTagFilters(["stage:Seed", "vertical:B2B"]);
    // Two different namespaces → two separate AND-able clauses
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ tags: { hasSome: ["stage:Seed"] } });
    expect(result).toContainEqual({ tags: { hasSome: ["vertical:B2B"] } });
  });

  it("groups tags from the same namespace into a single OR clause", () => {
    const result = buildTagFilters(["stage:Seed", "stage:Series A"]);
    // Same namespace → one clause with both values (OR semantics via hasSome)
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ tags: { hasSome: ["stage:Seed", "stage:Series A"] } });
  });

  it("handles tags without a namespace prefix under the _ bucket", () => {
    const result = buildTagFilters(["noprefix"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ tags: { hasSome: ["noprefix"] } });
  });

  it("mixes namespaced and un-namespaced tags correctly", () => {
    const result = buildTagFilters(["stage:Seed", "plainTag"]);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ tags: { hasSome: ["stage:Seed"] } });
    expect(result).toContainEqual({ tags: { hasSome: ["plainTag"] } });
  });
});

// ---------------------------------------------------------------------------
// selectCandidateIds
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = "campaign-abc";

const emptyCampaign = {
  filterTags: [],
  filterRegion: null,
  filterStage: null,
  filterBatch: null,
  filterIsHiring: null,
  filterHeadcountMin: null,
  filterHeadcountMax: null,
};

describe("selectCandidateIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty selectedIds when there are no matching companies at all", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([]);
    // Both the filtered and fallback queries return nothing
    mockPrisma.company.findMany.mockResolvedValue([]);

    const result = await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, [], 10);
    expect(result.selectedIds).toEqual([]);
    expect(result.usingFallback).toBe(true);
  });

  it("selects unseen candidates when they exist", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([]);
    mockPrisma.company.findMany.mockResolvedValue([
      { id: "co-1" },
      { id: "co-2" },
      { id: "co-3" },
    ]);

    const result = await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, [], 10);
    expect(result.usingFallback).toBe(false);
    expect(result.selectedIds).toHaveLength(3);
    expect(result.selectedIds).toEqual(expect.arrayContaining(["co-1", "co-2", "co-3"]));
  });

  it("falls back to all matching companies when all candidates are already seen", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([]);
    // First call (with exclusions) returns nothing; second call (fallback) returns results
    mockPrisma.company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "co-1" }, { id: "co-2" }]);

    const result = await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, ["co-1", "co-2"], 10);
    expect(result.usingFallback).toBe(true);
    expect(result.selectedIds).toHaveLength(2);
  });

  it("respects batchSize limit", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([]);
    const companies = Array.from({ length: 20 }, (_, i) => ({ id: `co-${i}` }));
    mockPrisma.company.findMany.mockResolvedValue(companies);

    const result = await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, [], 5);
    expect(result.selectedIds).toHaveLength(5);
    expect(result.usingFallback).toBe(false);
  });

  it("excludes seenIds when querying companies", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([]);
    mockPrisma.company.findMany.mockResolvedValue([{ id: "co-3" }]);

    await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, ["co-1", "co-2"], 10);

    const companyCall = mockPrisma.company.findMany.mock.calls[0][0];
    expect(companyCall.where.id).toEqual({ notIn: expect.arrayContaining(["co-1", "co-2"]) });
  });

  it("excludes company IDs already in the campaign (from campaignLead rows)", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([
      { userLead: { companyId: "co-already" } },
    ]);
    mockPrisma.company.findMany.mockResolvedValue([{ id: "co-new" }]);

    await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, [], 10);

    const companyCall = mockPrisma.company.findMany.mock.calls[0][0];
    expect(companyCall.where.id).toEqual({ notIn: expect.arrayContaining(["co-already"]) });
  });

  it("merges seenIds and campaign lead IDs into a deduplicated exclusion list", async () => {
    // "co-1" appears in both seenIds and campaign leads
    mockPrisma.campaignLead.findMany.mockResolvedValue([
      { userLead: { companyId: "co-1" } },
    ]);
    mockPrisma.company.findMany.mockResolvedValue([{ id: "co-3" }]);

    await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, ["co-1", "co-2"], 10);

    const companyCall = mockPrisma.company.findMany.mock.calls[0][0];
    const excluded: string[] = companyCall.where.id.notIn;
    // Deduplicated: co-1 should appear only once
    expect(excluded.filter((id: string) => id === "co-1")).toHaveLength(1);
    expect(excluded).toContain("co-2");
  });

  it("applies filterStage to the where clause", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([]);
    mockPrisma.company.findMany.mockResolvedValue([]);

    await selectCandidateIds(
      CAMPAIGN_ID,
      { ...emptyCampaign, filterStage: "Seed" },
      [],
      10
    );

    // Both calls (filtered and fallback) should use the same base where
    const call = mockPrisma.company.findMany.mock.calls[0][0];
    expect(call.where.stage).toBe("Seed");
  });

  it("applies filterIsHiring to the where clause", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([]);
    mockPrisma.company.findMany.mockResolvedValue([{ id: "co-1" }]);

    await selectCandidateIds(
      CAMPAIGN_ID,
      { ...emptyCampaign, filterIsHiring: true },
      [],
      10
    );

    const call = mockPrisma.company.findMany.mock.calls[0][0];
    expect(call.where.isHiring).toBe(true);
  });

  it("applies headcount range to the where clause", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([]);
    mockPrisma.company.findMany.mockResolvedValue([]);

    await selectCandidateIds(
      CAMPAIGN_ID,
      { ...emptyCampaign, filterHeadcountMin: 10, filterHeadcountMax: 50 },
      [],
      10
    );

    const call = mockPrisma.company.findMany.mock.calls[0][0];
    expect(call.where.headcount).toEqual({ gte: 10, lte: 50 });
  });

  it("does not add id exclusion clause when there are no excluded IDs", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([]);
    mockPrisma.company.findMany.mockResolvedValue([{ id: "co-1" }]);

    await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, [], 10);

    const call = mockPrisma.company.findMany.mock.calls[0][0];
    expect(call.where.id).toBeUndefined();
  });

  it("always sets isVerified: true in the where clause", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([]);
    mockPrisma.company.findMany.mockResolvedValue([]);

    await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, [], 10);

    const call = mockPrisma.company.findMany.mock.calls[0][0];
    expect(call.where.isVerified).toBe(true);
  });
});
