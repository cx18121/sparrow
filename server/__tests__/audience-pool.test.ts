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
  region: null,
  stage: null,
  batch: null,
  isHiring: null,
};

beforeEach(() => {
  Object.values(mockPrisma.company).forEach(mock => mock.mockReset());
  Object.values(mockPrisma.userLead).forEach(mock => mock.mockReset());
  Object.values(mockPrisma.campaignLead).forEach(mock => mock.mockReset());
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
  it("excludes seen and already-in-campaign company IDs before selecting candidates", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([
      { userLead: { companyId: "already-in-campaign" } },
    ]);
    mockPrisma.company.findMany.mockResolvedValueOnce([
      { id: "candidate-1" },
      { id: "candidate-2" },
    ]);

    const result = await selectAudienceCandidateIds({
      campaignId: "campaign-1",
      campaign: { filterTags: ["sector:ai"] },
      seenIds: ["seen-1"],
      batchSize: 1,
      db: mockPrisma as any,
    });

    expect(result.selectedIds).toHaveLength(1);
    expect(result.usingFallback).toBe(false);
    expect(mockPrisma.company.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { notIn: ["seen-1", "already-in-campaign"] },
      }),
    }));
  });

  it("falls back to all matching companies when the unseen pool is exhausted", async () => {
    mockPrisma.campaignLead.findMany.mockResolvedValue([]);
    mockPrisma.company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "fallback-1" }]);

    await expect(selectAudienceCandidateIds({
      campaignId: "campaign-1",
      campaign: { filterTags: ["sector:ai"] },
      seenIds: ["seen-1"],
      batchSize: 10,
      db: mockPrisma as any,
    })).resolves.toEqual({ selectedIds: ["fallback-1"], usingFallback: true });
  });
});
