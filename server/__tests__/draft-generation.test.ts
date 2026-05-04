import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports of the module under test
// ---------------------------------------------------------------------------

const {
  mockPrisma,
  mockReveal,
  mockResolveProfile,
  mockBuildContext,
  mockGenerateEmailDraft,
  MockProfileError,
} = vi.hoisted(() => {
  const mockPrisma = {
    customContact: { findUnique: vi.fn() },
    userLead: { findUnique: vi.fn(), update: vi.fn() },
    contact: { findUnique: vi.fn() },
    template: { findUnique: vi.fn() },
    email: { create: vi.fn() },
  };
  const mockReveal = vi.fn();
  const mockResolveProfile = vi.fn();
  const mockBuildContext = vi.fn();
  const mockGenerateEmailDraft = vi.fn();

  // ProfileError must be defined inside vi.hoisted() so the vi.mock() factory
  // (which is hoisted to the top of the file) can reference it safely.
  class MockProfileError extends Error {
    status: 400 | 500;
    constructor(message: string, status: 400 | 500) {
      super(message);
      this.status = status;
    }
  }

  return {
    mockPrisma,
    mockReveal,
    mockResolveProfile,
    mockBuildContext,
    mockGenerateEmailDraft,
    MockProfileError,
  };
});

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

vi.mock("../lib/apollo-enrichment.js", () => ({
  revealAndUpsertContact: mockReveal,
}));

vi.mock("../lib/sender-profile.js", () => ({
  resolveProfileForGeneration: mockResolveProfile,
  buildSenderContextFromProfile: mockBuildContext,
  ProfileError: MockProfileError,
}));

vi.mock("../lib/ai/generate-email.js", () => ({
  generateEmailDraft: mockGenerateEmailDraft,
}));

import { generateDraft, GenerationError } from "../lib/draft-generation.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const USER_ID = "user-draft-test";

const mockProfile = {
  apiKey: "sk-ant-test",
  senderName: "Alex",
  senderRole: "SWE Intern",
  resumeText: null,
  styleInstruction: null,
  ws: { styleProfile: null },
};

const mockDraft = { subject: "Quick intro — Alex", body: "Hi Sarah, …" };

const makeUserLead = (overrides: Record<string, unknown> = {}) => ({
  id: "lead-1",
  userId: USER_ID,
  companyId: "co-1",
  apolloPersonId: null,
  contact: {
    id: "contact-1",
    name: "Sarah Chen",
    title: "Head of Engineering",
  },
  company: {
    name: "Acme AI",
    description: "AI ops platform",
    oneLiner: "OS for AI ops",
    stage: "Series A",
    industry: "Enterprise SaaS",
    isHiring: true,
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateDraft — CustomContact path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProfile.mockResolvedValue(mockProfile);
    mockBuildContext.mockReturnValue("sender context string");
    mockGenerateEmailDraft.mockResolvedValue(mockDraft);
  });

  it("resolves the custom contact and generates a draft without touching userLead", async () => {
    mockPrisma.customContact.findUnique.mockResolvedValue({
      id: "cc-1",
      userId: USER_ID,
      name: "Jordan Lee",
      title: "CTO",
      companyName: "Startup Co",
    });
    mockPrisma.email.create.mockResolvedValue({ id: "email-cc-1" });

    const result = await generateDraft({ userId: USER_ID, customContactId: "cc-1" });

    expect(mockPrisma.customContact.findUnique).toHaveBeenCalledWith({ where: { id: "cc-1" } });
    expect(mockPrisma.userLead.findUnique).not.toHaveBeenCalled();
    expect(result.subject).toBe(mockDraft.subject);
    expect(result.body).toBe(mockDraft.body);
  });

  it("throws GenerationError(404) when custom contact belongs to a different user", async () => {
    mockPrisma.customContact.findUnique.mockResolvedValue({
      id: "cc-1",
      userId: "other-user",
      name: "X",
      title: null,
      companyName: null,
    });

    await expect(
      generateDraft({ userId: USER_ID, customContactId: "cc-1" })
    ).rejects.toThrow(GenerationError);
  });

  it("throws GenerationError(404) when custom contact is not found", async () => {
    mockPrisma.customContact.findUnique.mockResolvedValue(null);

    const err = await generateDraft({ userId: USER_ID, customContactId: "cc-missing" }).catch(
      e => e
    );
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.status).toBe(404);
  });
});

describe("generateDraft — UserLead path (lead with existing contact)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProfile.mockResolvedValue(mockProfile);
    mockBuildContext.mockReturnValue("sender context string");
    mockGenerateEmailDraft.mockResolvedValue(mockDraft);
  });

  it("generates a draft using the lead's existing contact", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.email.create.mockResolvedValue({ id: "email-lead-1" });

    const result = await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(mockPrisma.userLead.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "lead-1" } })
    );
    expect(mockReveal).not.toHaveBeenCalled();
    expect(result.subject).toBe(mockDraft.subject);
    expect(result.body).toBe(mockDraft.body);
    expect(result.fallback).toBeUndefined();
  });

  it("throws GenerationError(404) when lead is not found", async () => {
    mockPrisma.userLead.findUnique.mockResolvedValue(null);

    const err = await generateDraft({ userId: USER_ID, userLeadId: "no-lead" }).catch(e => e);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.status).toBe(404);
  });

  it("throws GenerationError(404) when lead belongs to a different user", async () => {
    mockPrisma.userLead.findUnique.mockResolvedValue(makeUserLead({ userId: "other-user" }));

    const err = await generateDraft({ userId: USER_ID, userLeadId: "lead-1" }).catch(e => e);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.status).toBe(404);
  });
});

describe("generateDraft — UserLead path (Apollo reveal)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProfile.mockResolvedValue(mockProfile);
    mockBuildContext.mockReturnValue("sender context string");
    mockGenerateEmailDraft.mockResolvedValue(mockDraft);
    // Provide an Apollo key so reveal is attempted
    vi.stubEnv("APOLLO_API_KEY", "apollo-key-test");
  });

  it("calls revealAndUpsertContact when lead has apolloPersonId but no contact", async () => {
    const lead = makeUserLead({ contact: null, apolloPersonId: "apollo-person-1" });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    const savedContact = { id: "contact-revealed", name: "Sarah Chen", title: "CTO" };
    mockReveal.mockResolvedValue(savedContact);
    mockPrisma.userLead.update.mockResolvedValue({});
    mockPrisma.contact.findUnique.mockResolvedValue(savedContact);
    mockPrisma.email.create.mockResolvedValue({ id: "email-revealed" });

    const result = await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(mockReveal).toHaveBeenCalledWith("apollo-person-1", "co-1", "apollo-key-test", USER_ID);
    expect(mockPrisma.userLead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { contactId: "contact-revealed" },
    });
    expect(result.subject).toBeTruthy();
    expect(result.fallback).toBeUndefined();
  });

  it("throws GenerationError(400) when lead has no contact and reveal returns null", async () => {
    const lead = makeUserLead({ contact: null, apolloPersonId: "apollo-person-1" });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockReveal.mockResolvedValue(null);
    mockPrisma.email.create.mockResolvedValue({ id: "email-x" });

    const err = await generateDraft({ userId: USER_ID, userLeadId: "lead-1" }).catch(e => e);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.status).toBe(400);
  });

  it("throws GenerationError(400) when lead has no contact and no apolloPersonId", async () => {
    const lead = makeUserLead({ contact: null, apolloPersonId: null });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);

    const err = await generateDraft({ userId: USER_ID, userLeadId: "lead-1" }).catch(e => e);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.status).toBe(400);
  });
});

describe("generateDraft — ProfileError propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildContext.mockReturnValue("sender context string");
    mockGenerateEmailDraft.mockResolvedValue(mockDraft);
  });

  it("propagates ProfileError thrown by resolveProfileForGeneration", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockResolveProfile.mockRejectedValue(
      new MockProfileError("Email generation is not configured on this deployment.", 500)
    );

    const err = await generateDraft({ userId: USER_ID, userLeadId: "lead-1" }).catch(e => e);
    expect(err).toBeInstanceOf(MockProfileError);
    expect(err.status).toBe(500);
    expect(err.message).toMatch(/not configured/);
  });
});

describe("generateDraft — Template path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProfile.mockResolvedValue(mockProfile);
    mockBuildContext.mockReturnValue("sender context string");
    mockGenerateEmailDraft.mockResolvedValue(mockDraft);
  });

  it("fetches template and passes kind:template to generateEmailDraft", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.template.findUnique.mockResolvedValue({
      id: "tmpl-1",
      userId: USER_ID,
      isShared: false,
      subject: "Hello from {{senderName}}",
      body: "Hi {{firstName}}, I'm reaching out about {{company}}.",
    });
    mockPrisma.email.create.mockResolvedValue({ id: "email-tmpl-1" });

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1", templateId: "tmpl-1" });

    const draftInputArg = mockGenerateEmailDraft.mock.calls[0][0];
    expect(draftInputArg.kind).toBe("template");
    expect(draftInputArg.body).toBe(
      "Hi {{firstName}}, I'm reaching out about {{company}}."
    );
  });

  it("throws GenerationError(404) when templateId is provided but template not found", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.template.findUnique.mockResolvedValue(null);

    const err = await generateDraft({
      userId: USER_ID,
      userLeadId: "lead-1",
      templateId: "tmpl-missing",
    }).catch(e => e);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.status).toBe(404);
  });
});

describe("generateDraft — AI fallback on generateEmailDraft failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProfile.mockResolvedValue(mockProfile);
    mockBuildContext.mockReturnValue("sender context string");
  });

  it("falls back to kind:fallback draft and sets fallback:true when generateEmailDraft throws", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.email.create.mockResolvedValue({ id: "email-fallback" });

    const fallbackDraft = { subject: "Quick intro", body: "Hi Sarah, I saw Acme AI …" };
    mockGenerateEmailDraft
      .mockRejectedValueOnce(new Error("Anthropic API 429: rate limited"))
      .mockResolvedValueOnce(fallbackDraft);

    const result = await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(result.fallback).toBe(true);
    expect(result.error).toMatch(/429/);
    expect(result.subject).toBe(fallbackDraft.subject);
    expect(result.body).toBe(fallbackDraft.body);

    // Second call must be the fallback kind
    const secondCall = mockGenerateEmailDraft.mock.calls[1][0];
    expect(secondCall.kind).toBe("fallback");
  });
});

describe("generateDraft — save flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProfile.mockResolvedValue(mockProfile);
    mockBuildContext.mockReturnValue("sender context string");
    mockGenerateEmailDraft.mockResolvedValue(mockDraft);
  });

  it("does NOT create an email record when save=false", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);

    const result = await generateDraft({ userId: USER_ID, userLeadId: "lead-1", save: false });

    expect(mockPrisma.email.create).not.toHaveBeenCalled();
    expect(result.emailId).toBeNull();
  });

  it("creates an email record and returns emailId when save=true", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.email.create.mockResolvedValue({ id: "email-saved-1" });

    const result = await generateDraft({ userId: USER_ID, userLeadId: "lead-1", save: true });

    expect(mockPrisma.email.create).toHaveBeenCalledOnce();
    const createArg = mockPrisma.email.create.mock.calls[0][0];
    expect(createArg.data.subject).toBe(mockDraft.subject);
    expect(createArg.data.body).toBe(mockDraft.body);
    expect(createArg.data.status).toBe("draft");
    expect(result.emailId).toBe("email-saved-1");
  });

  it("saves with userLeadId and contactId for lead-based drafts", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.email.create.mockResolvedValue({ id: "email-lead-save" });

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1", save: true });

    const createArg = mockPrisma.email.create.mock.calls[0][0];
    expect(createArg.data.userLeadId).toBe("lead-1");
    expect(createArg.data.contactId).toBe("contact-1");
    expect(createArg.data.customContactId).toBeUndefined();
  });

  it("saves with customContactId for custom-contact-based drafts", async () => {
    mockPrisma.customContact.findUnique.mockResolvedValue({
      id: "cc-1",
      userId: USER_ID,
      name: "Jordan",
      title: null,
      companyName: "ACME",
    });
    mockPrisma.email.create.mockResolvedValue({ id: "email-cc-save" });

    await generateDraft({ userId: USER_ID, customContactId: "cc-1", save: true });

    const createArg = mockPrisma.email.create.mock.calls[0][0];
    expect(createArg.data.customContactId).toBe("cc-1");
    expect(createArg.data.userLeadId).toBeUndefined();
  });

  it("does NOT save by default when save param is omitted (explicit-opt-in contract)", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);

    const result = await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(mockPrisma.email.create).not.toHaveBeenCalled();
    expect(result.emailId).toBeNull();
  });
});
