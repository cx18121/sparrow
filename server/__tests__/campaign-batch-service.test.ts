import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    campaignLead: {
      findMany: vi.fn(),
    },
    company: {
      findMany: vi.fn(),
    },
    // selectCandidateIds delegates to selectAudienceCandidateIds, which
    // moved from Prisma findMany to raw SQL on 2026-05-22. Mock $queryRaw
    // and assert on the behavioral shape; WHERE-predicate construction is
    // covered separately in audience-query.test.ts.
    $queryRaw: vi.fn(),
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

import { buildTagFilters, selectCandidateIds } from "../lib/company-selection.js";

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
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ tags: { hasSome: ["stage:Seed"] } });
    expect(result).toContainEqual({ tags: { hasSome: ["vertical:B2B"] } });
  });

  it("groups tags from the same namespace into a single OR clause", () => {
    const result = buildTagFilters(["stage:Seed", "stage:Series A"]);
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
};

describe("selectCandidateIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty selectedIds when there are no matching companies at all", async () => {
    // Both the anti-join and the fallback return empty.
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const result = await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, [], 10);
    expect(result.selectedIds).toEqual([]);
    expect(result.usingFallback).toBe(true);
  });

  it("selects unseen candidates when they exist", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
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
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "co-1" }, { id: "co-2" }]);

    const result = await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, ["co-1", "co-2"], 10);
    expect(result.usingFallback).toBe(true);
    expect(result.selectedIds).toHaveLength(2);
  });

  it("respects batchSize as the LIMIT on the candidate query", async () => {
    // Postgres LIMIT does the slicing now — mock returns exactly batchSize.
    const companies = Array.from({ length: 5 }, (_, i) => ({ id: `co-${i}` }));
    mockPrisma.$queryRaw.mockResolvedValueOnce(companies);

    const result = await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, [], 5);
    expect(result.selectedIds).toHaveLength(5);
    expect(result.usingFallback).toBe(false);

    // batchSize should appear in the SQL parameters.
    const firstCall = mockPrisma.$queryRaw.mock.calls[0][0];
    expect(firstCall.values).toContain(5);
  });

  it("passes seenIds into the anti-join query as a text[] parameter", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: "co-3" }]);

    await selectCandidateIds(CAMPAIGN_ID, emptyCampaign, ["co-1", "co-2"], 10);

    const firstCall = mockPrisma.$queryRaw.mock.calls[0][0];
    // The seenIds array is passed verbatim — Postgres handles the != ALL
    // against the array internally.
    expect(firstCall.values).toEqual(expect.arrayContaining([["co-1", "co-2"]]));
  });
});
