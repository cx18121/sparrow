import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    company: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    userLead: {
      findMany: vi.fn(),
    },
    campaignLead: {
      findMany: vi.fn(),
    },
    // selectAudienceCandidateIds went from Prisma findMany to raw SQL on
    // 2026-05-22 to avoid pulling 30k+ candidate IDs into JS just to shuffle.
    // Tests mock $queryRaw and assert behavioral shape (selectedIds,
    // usingFallback) rather than inspecting WHERE-clause internals; the raw
    // SQL parity is covered separately in audience-query.test.ts.
    $queryRaw: vi.fn(),
  };
  return { mockPrisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

import {
  previewAudiencePool,
  selectAudienceCandidateIds,
} from "../lib/audience-pool.js";

const audience = {
  tags: ["sector:ai"],
  region: [],
  stage: [],
  batch: [],
  isHiring: null,
  targetRole: null,
};

beforeEach(() => {
  Object.values(mockPrisma.company).forEach(mock => mock.mockReset());
  Object.values(mockPrisma.userLead).forEach(mock => mock.mockReset());
  Object.values(mockPrisma.campaignLead).forEach(mock => mock.mockReset());
  mockPrisma.$queryRaw.mockReset();
});

describe("previewAudiencePool", () => {
  it("excludes previously saved Lead companies and returns a random sample", async () => {
    mockPrisma.userLead.findMany.mockResolvedValue([{ companyId: "company-1" }]);
    mockPrisma.company.count.mockResolvedValue(2);
    mockPrisma.company.findMany.mockResolvedValueOnce([{ name: "Acme" }, { name: "Beta" }]);

    await expect(previewAudiencePool("user-1", {
      audience,
      excludePreviouslySaved: true,
    })).resolves.toEqual({ count: 2, sample: expect.arrayContaining(["Acme", "Beta"]) });

    expect(mockPrisma.company.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { notIn: ["company-1"] } }),
    });
  });

  it("does not query saved Leads when previous saved companies are included", async () => {
    mockPrisma.company.count.mockResolvedValue(0);

    await previewAudiencePool("user-1", {
      audience,
      excludePreviouslySaved: false,
    });

    expect(mockPrisma.userLead.findMany).not.toHaveBeenCalled();
  });
});

describe("selectAudienceCandidateIds", () => {
  it("returns the candidate IDs surfaced by the anti-join query", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: "candidate-1" }]);

    const result = await selectAudienceCandidateIds({
      campaignId: "campaign-1",
      campaign: { filterTags: ["sector:ai"] },
      seenIds: ["seen-1"],
      batchSize: 1,
      db: mockPrisma as any,
    });

    expect(result.selectedIds).toEqual(["candidate-1"]);
    expect(result.usingFallback).toBe(false);
    // First $queryRaw call is the anti-join — its Prisma.Sql includes the
    // seenIds array as one of its parameters, and the campaignId as another.
    const firstCall = mockPrisma.$queryRaw.mock.calls[0][0];
    expect(firstCall.values).toContain("campaign-1");
    expect(firstCall.values).toEqual(expect.arrayContaining([["seen-1"]]));
  });

  it("falls back to all matching companies when the unseen pool is exhausted", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([])               // anti-join returned nothing
      .mockResolvedValueOnce([{ id: "fallback-1" }]); // fallback path runs

    await expect(selectAudienceCandidateIds({
      campaignId: "campaign-1",
      campaign: { filterTags: ["sector:ai"] },
      seenIds: ["seen-1"],
      batchSize: 10,
      db: mockPrisma as any,
    })).resolves.toEqual({ selectedIds: ["fallback-1"], usingFallback: true });

    // Should have called twice — once for the anti-join, once for the fallback.
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
