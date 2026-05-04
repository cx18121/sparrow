import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRevealPerson, mockEnrichDomain, mockConsumeQuota } = vi.hoisted(() => {
  const mockPrisma = {
    contact: {
      upsert: vi.fn(),
    },
  };
  return {
    mockPrisma,
    mockRevealPerson: vi.fn(),
    mockEnrichDomain: vi.fn(),
    mockConsumeQuota: vi.fn(),
  };
});

vi.mock("../lib/prisma.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("../lib/apollo.js", () => ({
  revealPerson: mockRevealPerson,
  enrichDomain: mockEnrichDomain,
}));

vi.mock("../lib/rate-limit.js", () => ({
  consumeDurableDailyQuota: mockConsumeQuota,
}));

import {
  enrichContactFromDomain,
  fetchEnrichedDomain,
  revealAndUpsertContact,
  upsertContactFromReveal,
} from "../lib/apollo-enrichment.js";

describe("Apollo enrichment helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APOLLO_REVEAL_DAILY_LIMIT;
    mockConsumeQuota.mockResolvedValue(undefined);
    mockPrisma.contact.upsert.mockResolvedValue({
      id: "contact-1",
      name: "Jane Smith",
      email: "jane@example.com",
      title: "Founder",
    });
  });

  it("does not persist a revealed contact without an email address", async () => {
    const contact = await upsertContactFromReveal(
      { name: "Jane Smith", email: null, title: "Founder", linkedinUrl: "https://linkedin.example/jane" },
      "company-1",
      mockPrisma as any,
    );

    expect(contact).toBeNull();
    expect(mockPrisma.contact.upsert).not.toHaveBeenCalled();
  });

  it("upserts revealed contacts by email and returns the saved public shape", async () => {
    const contact = await upsertContactFromReveal(
      {
        name: "Jane Smith",
        email: "jane@example.com",
        title: "Founder",
        linkedinUrl: "https://linkedin.example/jane",
      },
      "company-1",
      mockPrisma as any,
    );

    expect(mockPrisma.contact.upsert).toHaveBeenCalledWith({
      where: { email: "jane@example.com" },
      create: {
        companyId: "company-1",
        name: "Jane Smith",
        email: "jane@example.com",
        title: "Founder",
        role: null,
        linkedinUrl: "https://linkedin.example/jane",
        source: "apollo",
      },
      update: {
        name: "Jane Smith",
        title: "Founder",
        linkedinUrl: "https://linkedin.example/jane",
        lastVerifiedAt: expect.any(Date),
      },
    });
    expect(contact).toEqual({ id: "contact-1", name: "Jane Smith", email: "jane@example.com", title: "Founder" });
  });

  it("fetches domain enrichment without charging quota or writing contacts", async () => {
    mockEnrichDomain.mockResolvedValue({
      name: "Jane Smith",
      email: "jane@example.com",
      title: "Founder",
      linkedinUrl: null,
      personId: "person-1",
    });

    await expect(fetchEnrichedDomain("example.com", "apollo-key")).resolves.toMatchObject({
      email: "jane@example.com",
      personId: "person-1",
    });
    expect(mockEnrichDomain).toHaveBeenCalledWith("example.com", "apollo-key");
    expect(mockConsumeQuota).not.toHaveBeenCalled();
    expect(mockPrisma.contact.upsert).not.toHaveBeenCalled();
  });

  it("enforces reveal quota before enriching and persisting a domain contact", async () => {
    process.env.APOLLO_REVEAL_DAILY_LIMIT = "7";
    mockEnrichDomain.mockResolvedValue({
      name: "Jane Smith",
      email: "jane@example.com",
      title: "Founder",
      linkedinUrl: null,
      personId: "person-1",
    });
    const tx = {
      contact: {
        upsert: vi.fn().mockResolvedValue({
          id: "contact-1",
          name: "Jane Smith",
          email: "jane@example.com",
          title: "Founder",
        }),
      },
    };

    const result = await enrichContactFromDomain("example.com", "company-1", "apollo-key", "user-1", tx as any);

    expect(mockConsumeQuota).toHaveBeenCalledWith("apollo", "user-1", "reveal", 7, tx);
    expect(mockEnrichDomain).toHaveBeenCalledWith("example.com", "apollo-key");
    expect(tx.contact.upsert).toHaveBeenCalledOnce();
    expect(result).toEqual({
      contact: { id: "contact-1", name: "Jane Smith", email: "jane@example.com", title: "Founder" },
      apolloPersonId: "person-1",
    });
  });

  it("does not write a contact when domain enrichment finds no person", async () => {
    mockEnrichDomain.mockResolvedValue(null);

    await expect(enrichContactFromDomain("example.com", "company-1", "apollo-key", "user-1", mockPrisma as any)).resolves.toEqual({
      contact: null,
      apolloPersonId: null,
    });

    expect(mockConsumeQuota).toHaveBeenCalledOnce();
    expect(mockPrisma.contact.upsert).not.toHaveBeenCalled();
  });

  it("reveals a selected Apollo person and persists the contact behind quota enforcement", async () => {
    mockRevealPerson.mockResolvedValue({
      name: "Jane Smith",
      email: "jane@example.com",
      title: "Founder",
      linkedin_url: "https://linkedin.example/jane",
    });

    await expect(revealAndUpsertContact("person-1", "company-1", "apollo-key", "user-1")).resolves.toEqual({
      id: "contact-1",
      name: "Jane Smith",
      email: "jane@example.com",
      title: "Founder",
    });
    expect(mockConsumeQuota).toHaveBeenCalledWith("apollo", "user-1", "reveal", 50, mockPrisma);
    expect(mockRevealPerson).toHaveBeenCalledWith("person-1", "apollo-key");
    expect(mockPrisma.contact.upsert).toHaveBeenCalledOnce();
  });

  it("returns null when a selected Apollo person cannot be revealed", async () => {
    mockRevealPerson.mockResolvedValue(null);

    await expect(revealAndUpsertContact("person-1", "company-1", "apollo-key", "user-1")).resolves.toBeNull();

    expect(mockConsumeQuota).toHaveBeenCalledOnce();
    expect(mockPrisma.contact.upsert).not.toHaveBeenCalled();
  });
});
