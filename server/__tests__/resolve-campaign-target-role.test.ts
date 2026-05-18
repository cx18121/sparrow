import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated unit test for the per-campaign / workspace-default role resolution
// chain. Closes the loop Codex review flagged: a per-campaign filterTargetRole
// override has to actually flow into fit-angle picking, not just into Apollo
// discovery. The full draft-generation orchestrator has a heavy mock harness;
// resolveCampaignTargetRole was exposed specifically so the resolution chain
// could be exercised here without that overhead.

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    campaign: { findUnique: vi.fn() },
  },
}));

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

import { resolveCampaignTargetRole } from "../lib/draft-generation.js";

const USER_ID = "user-resolve-test";

describe("resolveCampaignTargetRole", () => {
  beforeEach(() => {
    mockPrisma.campaign.findUnique.mockReset();
  });

  it("uses the campaign's filterTargetRole when present, ignoring workspace default", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue({ userId: USER_ID, filterTargetRole: "gtm" });
    const result = await resolveCampaignTargetRole("c-1", USER_ID, "engineering");
    expect(result).toBe("gtm");
  });

  it("falls back to workspace default when the campaign has no override", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue({ userId: USER_ID, filterTargetRole: null });
    const result = await resolveCampaignTargetRole("c-1", USER_ID, "product");
    expect(result).toBe("product");
  });

  it("ignores a campaign owned by a different user — graceful fallback", async () => {
    // Stale or hostile client state must never cross-pollinate roles
    // between users. The function returns the requesting user's workspace
    // default instead of leaking the foreign campaign's value.
    mockPrisma.campaign.findUnique.mockResolvedValue({ userId: "someone-else", filterTargetRole: "gtm" });
    const result = await resolveCampaignTargetRole("c-foreign", USER_ID, "operations");
    expect(result).toBe("operations");
  });

  it("falls back to workspace default when the campaign id doesn't resolve to a row", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue(null);
    const result = await resolveCampaignTargetRole("c-missing", USER_ID, "product");
    expect(result).toBe("product");
  });

  it("returns null when no campaignId and no workspace default", async () => {
    const result = await resolveCampaignTargetRole(null, USER_ID, null);
    expect(result).toBe(null);
  });

  it("skips the DB lookup entirely when campaignId is null/undefined", async () => {
    // Standalone draft preview (no campaign context) should not pay a
    // round-trip cost just to learn the workspace default already in hand.
    await resolveCampaignTargetRole(null, USER_ID, "engineering");
    await resolveCampaignTargetRole(undefined, USER_ID, "engineering");
    expect(mockPrisma.campaign.findUnique).not.toHaveBeenCalled();
  });
});
