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
