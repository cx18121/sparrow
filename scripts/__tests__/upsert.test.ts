import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    company: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    contact: {
      upsert: vi.fn(),
    },
  };
  return { mockPrisma };
});

vi.mock("../_lib/prisma.js", () => ({
  prisma: mockPrisma,
}));

import { upsertCompany, upsertContact } from "../_lib/upsert.js";

describe("upsertCompany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts a company by domain", async () => {
    mockPrisma.company.findUnique.mockResolvedValue(null);
    const createdCompany = {
      id: "co-1",
      domain: "acme.com",
      name: "Acme Inc",
      source: "yc",
      tags: ["signal:yc-backed"],
      isVerified: true,
      qualityScore: 70,
    };
    mockPrisma.company.upsert.mockResolvedValue(createdCompany);

    const result = await upsertCompany({
      domain: "acme.com",
      name: "Acme Inc",
      source: "yc",
      tags: ["signal:yc-backed"],
      isVerified: true,
      qualityScore: 70,
    });

    expect(mockPrisma.company.upsert).toHaveBeenCalledOnce();
    const upsertCall = mockPrisma.company.upsert.mock.calls[0][0];
    expect(upsertCall.where.domain).toBe("acme.com");
    expect(result).toEqual(createdCompany);
  });

  it("is idempotent — running twice produces same state", async () => {
    const existingCompany = {
      id: "co-1",
      source: "yc",
      tags: ["signal:yc-backed"],
      isVerified: true,
      qualityScore: 70,
    };
    // First call: no existing record
    mockPrisma.company.findUnique.mockResolvedValueOnce(null);
    mockPrisma.company.upsert.mockResolvedValueOnce({ ...existingCompany, domain: "beta.io", name: "Beta" });

    // Second call: existing record found
    mockPrisma.company.findUnique.mockResolvedValueOnce(existingCompany);
    mockPrisma.company.upsert.mockResolvedValueOnce({ ...existingCompany, domain: "beta.io", name: "Beta" });

    const input = { domain: "beta.io", name: "Beta", source: "yc", isVerified: true, qualityScore: 70 };

    await upsertCompany(input);
    await upsertCompany(input);

    // Both calls should produce the same domain in the upsert where clause
    const calls = mockPrisma.company.upsert.mock.calls;
    expect(calls[0][0].where.domain).toBe("beta.io");
    expect(calls[1][0].where.domain).toBe("beta.io");
  });

  it("calls normalizeRegion on location field", async () => {
    mockPrisma.company.findUnique.mockResolvedValue(null);
    mockPrisma.company.upsert.mockResolvedValue({ id: "co-2", domain: "gamma.io" });

    await upsertCompany({
      domain: "gamma.io",
      name: "Gamma",
      source: "yc",
      location: "San Francisco, CA",
    });

    const upsertCall = mockPrisma.company.upsert.mock.calls[0][0];
    // normalizeRegion("San Francisco, CA") should produce "Bay Area"
    expect(upsertCall.create.region).toBe("Bay Area");
    expect(upsertCall.update.region).toBe("Bay Area");
  });

  it("normalizes domain to lowercase and strips www prefix", async () => {
    mockPrisma.company.findUnique.mockResolvedValue(null);
    mockPrisma.company.upsert.mockResolvedValue({ id: "co-3", domain: "example.com" });

    await upsertCompany({
      domain: "WWW.Example.COM",
      name: "Example",
      source: "yc",
    });

    const upsertCall = mockPrisma.company.upsert.mock.calls[0][0];
    expect(upsertCall.where.domain).toBe("example.com");
    expect(upsertCall.create.domain).toBe("example.com");
  });

  describe("stage inference", () => {
    it("infers stage on create when adapter does not emit one", async () => {
      mockPrisma.company.findUnique.mockResolvedValue(null);
      mockPrisma.company.upsert.mockResolvedValue({ id: "co-4", domain: "growth.co" });

      // Insight Partners is in the growth-equity rule set → Series C+.
      // signal:stage-inferred should be appended so we can audit the row.
      await upsertCompany({
        domain: "growth.co",
        name: "Growth Co",
        source: "insight",
        tags: ["investor:insight"],
        isVerified: true,
      });

      const call = mockPrisma.company.upsert.mock.calls[0][0];
      expect(call.create.stage).toBe("Series C+");
      expect(call.create.tags).toContain("investor:insight");
      expect(call.create.tags).toContain("signal:stage-inferred");
    });

    it("does not infer when adapter emits a source-of-truth stage", async () => {
      mockPrisma.company.findUnique.mockResolvedValue(null);
      mockPrisma.company.upsert.mockResolvedValue({ id: "co-5", domain: "real.co" });

      await upsertCompany({
        domain: "real.co",
        name: "Real Co",
        source: "yc",
        stage: "Series A",
        tags: ["signal:yc-backed"],
        isVerified: true,
      });

      const call = mockPrisma.company.upsert.mock.calls[0][0];
      expect(call.create.stage).toBe("Series A");
      // No inferred marker — the stage came from the adapter.
      expect(call.create.tags).not.toContain("signal:stage-inferred");
    });

    it("strips signal:stage-inferred when a real stage arrives later", async () => {
      // Existing row was inferred to Seed via investor:boxgroup; a follow-up
      // ingest brings a real Series A stage from a stage-aware adapter.
      // We expect the new write to remove the inferred marker.
      mockPrisma.company.findUnique.mockResolvedValue({
        id: "co-6",
        source: "boxgroup",
        tags: ["investor:boxgroup", "signal:stage-inferred"],
        isVerified: true,
        qualityScore: 60,
        stage: "Seed",
      });
      mockPrisma.company.upsert.mockResolvedValue({ id: "co-6", domain: "later.co" });

      await upsertCompany({
        domain: "later.co",
        name: "Later Co",
        source: "pear",
        stage: "Series A",
        tags: ["investor:pear"],
        isVerified: true,
      });

      const call = mockPrisma.company.upsert.mock.calls[0][0];
      expect(call.update.stage).toBe("Series A");
      expect(call.update.tags).toContain("investor:boxgroup");
      expect(call.update.tags).toContain("investor:pear");
      expect(call.update.tags).not.toContain("signal:stage-inferred");
    });

    it("leaves existing non-null stage untouched on sparse update", async () => {
      // Existing has a real Series B stage; new adapter with investor:insight
      // tag would infer Series C+, but inference must NOT fire when existing
      // stage exists — preserving the source-of-truth value.
      mockPrisma.company.findUnique.mockResolvedValue({
        id: "co-7",
        source: "battery",
        tags: ["investor:battery"],
        isVerified: true,
        qualityScore: 70,
        stage: "Series B",
      });
      mockPrisma.company.upsert.mockResolvedValue({ id: "co-7", domain: "preserve.co" });

      await upsertCompany({
        domain: "preserve.co",
        name: "Preserve Co",
        source: "insight",
        tags: ["investor:insight"],
        isVerified: true,
      });

      const call = mockPrisma.company.upsert.mock.calls[0][0];
      // No stage in update means sparse rule wins → existing Series B stays.
      expect(call.update.stage).toBeUndefined();
      expect(call.update.tags).not.toContain("signal:stage-inferred");
    });
  });
});

describe("upsertContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts a contact by email", async () => {
    const savedContact = {
      id: "contact-1",
      email: "alice@example.com",
      name: "Alice",
      title: "CTO",
      role: "technical",
      companyId: "co-1",
    };
    mockPrisma.contact.upsert.mockResolvedValue(savedContact);

    const result = await upsertContact({
      companyId: "co-1",
      email: "alice@example.com",
      name: "Alice",
      title: "CTO",
      source: "yc",
    });

    expect(mockPrisma.contact.upsert).toHaveBeenCalledOnce();
    const upsertCall = mockPrisma.contact.upsert.mock.calls[0][0];
    expect(upsertCall.where.email).toBe("alice@example.com");
    expect(result).toEqual(savedContact);
  });

  it("returns null when email is falsy", async () => {
    const result = await upsertContact({
      companyId: "co-1",
      email: "",
      source: "yc",
    });
    expect(result).toBeNull();
    expect(mockPrisma.contact.upsert).not.toHaveBeenCalled();
  });

  it("calls normalizeRole on title field", async () => {
    mockPrisma.contact.upsert.mockResolvedValue({ id: "c-1", email: "bob@example.com", role: "founder" });

    await upsertContact({
      companyId: "co-1",
      email: "bob@example.com",
      name: "Bob",
      title: "Co-Founder & CEO",
      source: "yc",
    });

    const upsertCall = mockPrisma.contact.upsert.mock.calls[0][0];
    // normalizeRole("Co-Founder & CEO") should produce "founder"
    expect(upsertCall.create.role).toBe("founder");
  });

  it("stores null role when title is null", async () => {
    mockPrisma.contact.upsert.mockResolvedValue({ id: "c-2", email: "carol@example.com", role: null });

    await upsertContact({
      companyId: "co-1",
      email: "carol@example.com",
      source: "yc",
    });

    const upsertCall = mockPrisma.contact.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBeNull();
  });
});
