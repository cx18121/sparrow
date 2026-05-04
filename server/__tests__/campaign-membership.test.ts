import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    campaign: { findUnique: vi.fn() },
    customContact: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    campaignLead: { findMany: vi.fn() },
    campaignCustomContact: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { mockPrisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

import {
  attachCustomContactToCampaign,
  listCampaignMembers,
  removeCampaignCustomContact,
} from "../lib/campaign-membership.js";

const USER_ID = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCampaignMembers", () => {
  it("returns both serialized leads and custom contacts for the campaign", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue({ id: "c1", userId: USER_ID });
    mockPrisma.campaignLead.findMany.mockResolvedValue([
      { id: "cl1", batchNumber: 1, userLead: { id: "ul1", company: { name: "Acme" } } },
    ]);
    mockPrisma.campaignCustomContact.findMany.mockResolvedValue([
      { id: "ccc1", customContact: { id: "cc1", name: "Test User", email: "x@y.com" } },
    ]);

    const result = await listCampaignMembers("c1", USER_ID);

    expect(result.items).toEqual([
      { id: "ul1", company: { name: "Acme" }, campaignLeadId: "cl1", batchNumber: 1 },
    ]);
    expect(result.customContacts).toEqual([
      { id: "cc1", name: "Test User", email: "x@y.com", campaignCustomContactId: "ccc1" },
    ]);
  });

  it("404s when the campaign belongs to another user", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue({ id: "c1", userId: "someone-else" });
    await expect(listCampaignMembers("c1", USER_ID)).rejects.toThrow(/Campaign not found/);
  });
});

describe("attachCustomContactToCampaign", () => {
  it("creates a join row when none exists", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue({ id: "c1", userId: USER_ID });
    mockPrisma.customContact.findUnique.mockResolvedValue({ id: "cc1", userId: USER_ID });
    mockPrisma.campaignCustomContact.findUnique.mockResolvedValue(null);
    mockPrisma.campaignCustomContact.create.mockResolvedValue({ id: "ccc-new" });

    const link = await attachCustomContactToCampaign("c1", "cc1", USER_ID);

    expect(link).toEqual({ id: "ccc-new" });
    expect(mockPrisma.campaignCustomContact.create).toHaveBeenCalledWith({
      data: { campaignId: "c1", customContactId: "cc1" },
    });
  });

  it("is idempotent when the contact is already attached", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue({ id: "c1", userId: USER_ID });
    mockPrisma.customContact.findUnique.mockResolvedValue({ id: "cc1", userId: USER_ID });
    mockPrisma.campaignCustomContact.findUnique.mockResolvedValue({ id: "ccc-existing" });

    const link = await attachCustomContactToCampaign("c1", "cc1", USER_ID);

    expect(link).toEqual({ id: "ccc-existing" });
    expect(mockPrisma.campaignCustomContact.create).not.toHaveBeenCalled();
  });

  it("rejects a contact owned by a different user", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue({ id: "c1", userId: USER_ID });
    mockPrisma.customContact.findUnique.mockResolvedValue({ id: "cc1", userId: "someone-else" });

    await expect(attachCustomContactToCampaign("c1", "cc1", USER_ID)).rejects.toThrow(/Contact not found/);
    expect(mockPrisma.campaignCustomContact.create).not.toHaveBeenCalled();
  });
});

describe("removeCampaignCustomContact", () => {
  it("deletes the join row when the campaign belongs to the user", async () => {
    mockPrisma.campaignCustomContact.findUnique.mockResolvedValue({
      id: "ccc1",
      campaign: { userId: USER_ID },
    });
    mockPrisma.campaignCustomContact.delete.mockResolvedValue({});

    await removeCampaignCustomContact("ccc1", USER_ID);

    expect(mockPrisma.campaignCustomContact.delete).toHaveBeenCalledWith({ where: { id: "ccc1" } });
  });

  it("404s when the join belongs to a different user", async () => {
    mockPrisma.campaignCustomContact.findUnique.mockResolvedValue({
      id: "ccc1",
      campaign: { userId: "someone-else" },
    });

    await expect(removeCampaignCustomContact("ccc1", USER_ID)).rejects.toThrow(/not found/i);
    expect(mockPrisma.campaignCustomContact.delete).not.toHaveBeenCalled();
  });
});
