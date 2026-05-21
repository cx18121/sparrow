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
  mockResearchCompanyDossier,
  mockPickFitAngle,
  mockResearchFitAngle,
  mockResearchCompanyDossierGtm,
  mockPickGtmAngle,
  mockResearchCompanyDossierOps,
  mockPickOpsAngle,
  MockProfileError,
} = vi.hoisted(() => {
  const mockPrisma = {
    customContact: { findUnique: vi.fn() },
    userLead: { findUnique: vi.fn(), update: vi.fn() },
    contact: { findUnique: vi.fn() },
    template: { findUnique: vi.fn() },
    email: { create: vi.fn(), findFirst: vi.fn() },
    company: { update: vi.fn(), findUnique: vi.fn() },
    // resolveCampaignTargetRole hits this when generateDraft is called with
    // campaignId. Tests that omit campaignId never touch it.
    campaign: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  };
  const mockReveal = vi.fn();
  const mockResolveProfile = vi.fn();
  const mockBuildContext = vi.fn();
  const mockGenerateEmailDraft = vi.fn();
  const mockResearchCompanyDossier = vi.fn();
  const mockPickFitAngle = vi.fn();
  const mockResearchFitAngle = vi.fn();
  // ADR-0005 slice 2: GTM pipeline mocks. The orchestrator dispatches to
  // these when targetRole === 'gtm'; eng/product/null still hit the eng pair.
  const mockResearchCompanyDossierGtm = vi.fn();
  const mockPickGtmAngle = vi.fn();
  // ADR-0005 slice 3: ops pipeline mocks. Same pattern as GTM; orchestrator
  // dispatches when targetRole === 'operations'.
  const mockResearchCompanyDossierOps = vi.fn();
  const mockPickOpsAngle = vi.fn();

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
    mockResearchCompanyDossier,
    mockPickFitAngle,
    mockResearchFitAngle,
    mockResearchCompanyDossierGtm,
    mockPickGtmAngle,
    mockResearchCompanyDossierOps,
    mockPickOpsAngle,
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

vi.mock("../lib/ai/research-fit-angle.js", async () => {
  // Mock the LLM-calling functions, but use the real parseCachedDossier so
  // its validation behavior is exercised by orchestrator tests.
  const actual = await vi.importActual<typeof import("../lib/ai/research-fit-angle.js")>(
    "../lib/ai/research-fit-angle.js"
  );
  return {
    ...actual,
    // Both names point at the same spy so test fixtures don't have to track
    // which retrieval function the orchestrator currently calls. Production
    // routes through the hybrid path; the Tavily-only export stays for
    // direct callers (smoke scripts, retrieval A/B harness).
    researchCompanyDossier: mockResearchCompanyDossier,
    researchCompanyDossierHybrid: mockResearchCompanyDossier,
    pickFitAngle: mockPickFitAngle,
    // ADR-0005 slice 2: GTM path is mocked independently so tests can
    // assert dispatch (eng vs gtm) on the same orchestrator under different
    // targetRole values.
    researchCompanyDossierGtmHybrid: mockResearchCompanyDossierGtm,
    pickGtmAngle: mockPickGtmAngle,
    // ADR-0005 slice 3
    researchCompanyDossierOpsHybrid: mockResearchCompanyDossierOps,
    pickOpsAngle: mockPickOpsAngle,
  };
});

import { generateDraft, GenerationError } from "../lib/draft-generation.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const USER_ID = "user-draft-test";

const mockProfile = {
  apiKey: "sk-ant-test",
  senderName: "Alex",
  resumeText: null,
  ws: {},
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
    mockPrisma.email.findFirst.mockReset();
    mockPrisma.email.create.mockReset();
    mockPrisma.$executeRaw.mockReset();
    mockPrisma.$transaction.mockReset();
    mockPrisma.email.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockResolveProfile.mockResolvedValue(mockProfile);
    mockBuildContext.mockReturnValue("sender context string");
    mockGenerateEmailDraft.mockResolvedValue(mockDraft);
    mockResearchCompanyDossier.mockResolvedValue({ summary: "", surfaces: [], recentLaunches: [], technicalAreas: [] });
    mockPickFitAngle.mockResolvedValue({ featureLine: null, fitAngle: null });
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
    mockResearchCompanyDossier.mockResolvedValue({ summary: "", surfaces: [], recentLaunches: [], technicalAreas: [] });
    mockPickFitAngle.mockResolvedValue({ featureLine: null, fitAngle: null });
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
    mockResearchCompanyDossier.mockResolvedValue({ summary: "", surfaces: [], recentLaunches: [], technicalAreas: [] });
    mockPickFitAngle.mockResolvedValue({ featureLine: null, fitAngle: null });
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
    mockResearchCompanyDossier.mockResolvedValue({ summary: "", surfaces: [], recentLaunches: [], technicalAreas: [] });
    mockPickFitAngle.mockResolvedValue({ featureLine: null, fitAngle: null });
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
    mockResearchCompanyDossier.mockResolvedValue({ summary: "", surfaces: [], recentLaunches: [], technicalAreas: [] });
    mockPickFitAngle.mockResolvedValue({ featureLine: null, fitAngle: null });
  });

  it("fetches template and passes an AI-personalized skeleton to generateEmailDraft", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.template.findUnique.mockResolvedValue({
      id: "tmpl-1",
      userId: USER_ID,
      isShared: false,
      verbatim: false,
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
    expect(draftInputArg.senderContext).toBe("sender context string");
    expect(draftInputArg.apiKey).toBe(mockProfile.apiKey);
  });

  it("uses verbatim mode when the template is marked verbatim and feature_line is referenced + present", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.company.update.mockResolvedValue({});
    mockPrisma.template.findUnique.mockResolvedValue({
      id: "tmpl-v",
      userId: USER_ID,
      isShared: false,
      verbatim: true,
      subject: "Quick thought on {{company}}",
      body: "Hi {{first_name}}, saw {{feature_line}} — quick chat?",
    });
    mockPickFitAngle.mockResolvedValue({ featureLine: "the eval harness", fitAngle: "my eval project" });

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1", templateId: "tmpl-v" });

    expect(mockGenerateEmailDraft.mock.calls[0][0].kind).toBe("verbatim");
  });

  it("keeps verbatim mode when feature_line is missing so the checkbox is honored", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.company.update.mockResolvedValue({});
    mockPrisma.template.findUnique.mockResolvedValue({
      id: "tmpl-v",
      userId: USER_ID,
      isShared: false,
      verbatim: true,
      subject: "Hi",
      body: "Hi {{first_name}}, saw {{feature_line}} — quick chat?",
    });
    mockPickFitAngle.mockResolvedValue({ featureLine: null, fitAngle: null });

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1", templateId: "tmpl-v" });

    expect(mockGenerateEmailDraft.mock.calls[0][0].kind).toBe("verbatim");
  });

  it("uses verbatim mode for templates that don't reference feature_line at all", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.company.update.mockResolvedValue({});
    mockPrisma.template.findUnique.mockResolvedValue({
      id: "tmpl-static",
      userId: USER_ID,
      isShared: false,
      verbatim: true,
      subject: "Hello",
      body: "Hi {{first_name}}, hope you're well. Quick question — coffee?",
    });
    mockPickFitAngle.mockResolvedValue({ featureLine: null, fitAngle: null });

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1", templateId: "tmpl-static" });

    expect(mockGenerateEmailDraft.mock.calls[0][0].kind).toBe("verbatim");
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

  it("throws GenerationError(404) when templateId belongs to another user even if isShared is true", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.template.findUnique.mockResolvedValue({
      id: "tmpl-shared",
      userId: "other-user",
      isShared: true,
      subject: "Hello",
      body: "Hi",
    });

    const err = await generateDraft({
      userId: USER_ID,
      userLeadId: "lead-1",
      templateId: "tmpl-shared",
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

describe("generateDraft — dossier cache + per-user fit-angle pick", () => {
  const dossier = {
    summary: "AI ops platform.",
    surfaces: ["the agent eval harness"],
    recentLaunches: [],
    technicalAreas: ["multi-agent orchestration"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProfile.mockResolvedValue({
      ...mockProfile,
      resumeText: "Cornell CS. Built a multi-agent eval harness.",
    });
    mockBuildContext.mockReturnValue("sender context string");
    mockGenerateEmailDraft.mockResolvedValue(mockDraft);
    mockResearchCompanyDossier.mockResolvedValue(dossier);
    mockPickFitAngle.mockResolvedValue({
      featureLine: "the agent eval harness",
      fitAngle: "my multi-agent eval project",
    });
    // Default the cache-write re-read (ADR-0005 cross-role defense) to a
    // miss; specific tests that exercise the re-read override this.
    mockPrisma.company.findUnique.mockResolvedValue(null);
    // ADR-0005 slice 2 defaults for the GTM pipeline. Eng-path tests
    // don't hit these but they need to exist so the imports resolve.
    mockResearchCompanyDossierGtm.mockResolvedValue({
      summary: "",
      triggers: [],
      recentMoves: [],
      marketSignals: [],
    });
    mockPickGtmAngle.mockResolvedValue({ triggerLine: null, proofOfMotion: null });
    // ADR-0005 slice 3 defaults for the ops pipeline.
    mockResearchCompanyDossierOps.mockResolvedValue({
      summary: "",
      inflections: [],
      recentHires: [],
      openRoles: [],
    });
    mockPickOpsAngle.mockResolvedValue({ inflectionLine: null, systemBuilt: null });
  });

  it("uses cached dossier from Company.researchDossier when fresh (< 30 days old)", async () => {
    const recent = new Date();
    const lead = makeUserLead({
      company: {
        ...makeUserLead().company,
        researchDossier: dossier,
        researchedAt: recent,
      },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(mockResearchCompanyDossier).not.toHaveBeenCalled();
    expect(mockPrisma.company.update).not.toHaveBeenCalled();
    expect(mockPickFitAngle).toHaveBeenCalledOnce();
    expect(mockPickFitAngle.mock.calls[0][0].dossier).toEqual(dossier);
  });

  it("researches and persists a fresh dossier when none exists", async () => {
    const lead = makeUserLead({
      company: { ...makeUserLead().company, researchDossier: null, researchedAt: null },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.company.update.mockResolvedValue({});

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(mockResearchCompanyDossier).toHaveBeenCalledOnce();
    expect(mockPrisma.company.update).toHaveBeenCalledOnce();
    const updateArg = mockPrisma.company.update.mock.calls[0][0];
    expect(updateArg.where.id).toBe("co-1");
    // Post-ADR-0005: cache write produces the per-role envelope, not the
    // flat dossier. The engineering slot is the default for null targetRole
    // (no workspace default in mockProfile.ws.targetRole), product, and
    // engineering all share that slot.
    expect(updateArg.data.researchDossier).toEqual({
      engineering: { dossier, researchedAt: expect.any(Date) },
      gtm: null,
      operations: null,
    });
    expect(updateArg.data.researchedAt).toBeInstanceOf(Date);
  });

  it("re-researches when cached dossier has malformed shape", async () => {
    // Old/corrupted cache shape: required field is wrong type. Should be
    // treated as cache miss and re-researched, not silently flowed through.
    const lead = makeUserLead({
      company: {
        ...makeUserLead().company,
        researchDossier: { summary: "stale", surfaces: "not-an-array" },
        researchedAt: new Date(),
      },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.company.update.mockResolvedValue({});

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(mockResearchCompanyDossier).toHaveBeenCalledOnce();
    expect(mockPrisma.company.update).toHaveBeenCalledOnce();
  });

  it("does not re-research even when the dossier is months old (cache is indefinite)", async () => {
    const ancient = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const cachedDossier = { summary: "old", surfaces: ["old surface"], recentLaunches: [], technicalAreas: [] };
    const lead = makeUserLead({
      company: {
        ...makeUserLead().company,
        researchDossier: cachedDossier,
        researchedAt: ancient,
      },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(mockResearchCompanyDossier).not.toHaveBeenCalled();
    expect(mockPrisma.company.update).not.toHaveBeenCalled();
  });

  it("forwards picked featureLine and fitAngle into generateEmailDraft input", async () => {
    const lead = makeUserLead({
      company: { ...makeUserLead().company, researchDossier: dossier, researchedAt: new Date() },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    const draftInput = mockGenerateEmailDraft.mock.calls[0][0];
    expect(draftInput.featureLine).toBe("the agent eval harness");
    expect(draftInput.fitAngle).toBe("my multi-agent eval project");
  });

  it("skips dossier + pick when caller supplies an interestHook", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);

    await generateDraft({
      userId: USER_ID,
      userLeadId: "lead-1",
      interestHook: "your post on agent eval",
    });

    expect(mockResearchCompanyDossier).not.toHaveBeenCalled();
    expect(mockPickFitAngle).not.toHaveBeenCalled();
    const draftInput = mockGenerateEmailDraft.mock.calls[0][0];
    expect(draftInput.interestHook).toBe("your post on agent eval");
  });

  it("still drafts the email when researchCompanyDossier throws", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockResearchCompanyDossier.mockRejectedValue(new Error("research API failed"));

    const result = await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(result.subject).toBe(mockDraft.subject);
    const draftInput = mockGenerateEmailDraft.mock.calls[0][0];
    expect(draftInput.featureLine).toBeNull();
    expect(draftInput.fitAngle).toBeNull();
  });

  it("dedupes concurrent research for the same companyId — only one Tavily/Claude call", async () => {
    const lead = makeUserLead({
      company: { ...makeUserLead().company, researchDossier: null, researchedAt: null },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.company.update.mockResolvedValue({});

    // Slow research call so the second caller arrives while the first is in flight.
    let resolveResearch!: (d: typeof dossier) => void;
    mockResearchCompanyDossier.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveResearch = resolve;
        })
    );

    const p1 = generateDraft({ userId: USER_ID, userLeadId: "lead-1" });
    const p2 = generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    // Yield long enough for both generateDraft chains to reach their
    // researchCompanyDossier call (multiple awaits beforehand).
    await new Promise(r => setTimeout(r, 10));
    resolveResearch(dossier);

    await Promise.all([p1, p2]);

    // Both drafts succeeded but Tavily/Claude was called only once.
    expect(mockResearchCompanyDossier).toHaveBeenCalledTimes(1);
    expect(mockPickFitAngle).toHaveBeenCalledTimes(2);
  });

  it("reads from the envelope's engineering slot when researchDossier is already envelope-shaped", async () => {
    // Post-ADR-0005 envelope shape. The orchestrator should pull the
    // engineering slot for a null/eng/product target role and skip research.
    const recent = new Date();
    const lead = makeUserLead({
      company: {
        ...makeUserLead().company,
        researchDossier: {
          engineering: { dossier, researchedAt: recent.toISOString() },
          gtm: null,
          operations: null,
        },
        researchedAt: recent,
      },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(mockResearchCompanyDossier).not.toHaveBeenCalled();
    expect(mockPrisma.company.update).not.toHaveBeenCalled();
    expect(mockPickFitAngle.mock.calls[0][0].dossier).toEqual(dossier);
  });

  it("re-reads the envelope at write time to defend against cross-role concurrent clobber", async () => {
    // Cross-role race scenario: at draft-generation start, the company has
    // an empty envelope (no slots populated). Mid-research, a different
    // role's research completes for the same company and writes its slot.
    // The cache write here must merge into the latest DB state, not the
    // stale envelope captured at the start. We simulate by returning a
    // different envelope from company.findUnique (the re-read) than what
    // was on the lead initially.
    const lead = makeUserLead({
      company: { ...makeUserLead().company, researchDossier: null, researchedAt: null },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);

    // Simulate that mid-research, a GTM call landed and wrote its slot.
    // Per ADR-0005 slice 2, the gtm slot carries GtmDossier shape.
    const concurrentGtmDossier = {
      summary: "GTM dossier from concurrent write",
      triggers: ["new VP Sales hire"],
      recentMoves: [],
      marketSignals: [],
    };
    mockPrisma.company.findUnique.mockResolvedValue({
      researchDossier: {
        engineering: null,
        gtm: { dossier: concurrentGtmDossier, researchedAt: new Date().toISOString() },
        operations: null,
      },
      researchedAt: new Date(),
    });
    mockPrisma.company.update.mockResolvedValue({});

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(mockPrisma.company.findUnique).toHaveBeenCalledWith({
      where: { id: "co-1" },
      select: { researchDossier: true, researchedAt: true },
    });
    const updateArg = mockPrisma.company.update.mock.calls[0][0];
    // The eng slot got written, AND the gtm slot is preserved from the
    // mid-research concurrent write.
    expect(updateArg.data.researchDossier.engineering).toEqual({
      dossier,
      researchedAt: expect.any(Date),
    });
    expect(updateArg.data.researchDossier.gtm).toEqual({
      dossier: concurrentGtmDossier,
      researchedAt: expect.any(Date),
    });
  });

  it("read-modify-writes the envelope so a fresh research preserves other roles' slots", async () => {
    // The eng slot is missing/stale; the gtm slot has prior research that
    // must NOT be wiped when the eng pipeline writes back. This is the
    // load-bearing contract for ADR-0005 slice 2+: each pipeline writes
    // its own slot via read-modify-write, never the whole envelope.
    const existingGtmDossier = {
      summary: "GTM-shaped dossier",
      triggers: ["recent Series B announcement"],
      recentMoves: [],
      marketSignals: [],
    };
    const lead = makeUserLead({
      company: {
        ...makeUserLead().company,
        researchDossier: {
          engineering: null,
          gtm: { dossier: existingGtmDossier, researchedAt: new Date().toISOString() },
          operations: null,
        },
        researchedAt: new Date(),
      },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.company.update.mockResolvedValue({});

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(mockResearchCompanyDossier).toHaveBeenCalledOnce();
    const updateArg = mockPrisma.company.update.mock.calls[0][0];
    expect(updateArg.data.researchDossier.gtm).toEqual({
      dossier: existingGtmDossier,
      researchedAt: expect.any(Date),
    });
    expect(updateArg.data.researchDossier.engineering).toEqual({
      dossier,
      researchedAt: expect.any(Date),
    });
  });

  it("characterization — orchestrator wiring is byte-identical for the engineering happy path", async () => {
    // Regression guard for ADR-0005 slice 1. Captures the full DraftInput
    // the orchestrator hands to generateEmailDraft when an engineering lead
    // has a fresh cached dossier. Any slice 1 change that alters this
    // payload — cache shape, dossier flow, role threading — will surface
    // here without needing to inspect the orchestrator internals.
    const recent = new Date("2026-05-19T12:00:00.000Z");
    const lead = makeUserLead({
      company: {
        ...makeUserLead().company,
        researchDossier: dossier,
        researchedAt: recent,
      },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);

    const result = await generateDraft({ userId: USER_ID, userLeadId: "lead-1" });

    expect(result).toMatchSnapshot("draft result");

    const pickArg = mockPickFitAngle.mock.calls[0][0];
    expect(pickArg.dossier).toEqual(dossier);
    expect(pickArg.targetRole).toBeNull();

    const draftInput = mockGenerateEmailDraft.mock.calls[0][0];
    // Strip apiKey (test-private) before snapshotting; senderContext is
    // captured by a separate mockBuildContext spy so omit it too.
    const { apiKey: _key, senderContext: _ctx, ...snapshotInput } = draftInput;
    expect(snapshotInput).toMatchSnapshot("draft input");
  });

  it("dispatches to the GTM pipeline when workspace targetRole is gtm", async () => {
    // ADR-0005 slice 2 dispatch contract: when targetRole resolves to
    // 'gtm', the orchestrator routes to pickGtmAngle (not pickFitAngle),
    // research goes through the GTM hybrid (not eng hybrid), the GTM cache
    // slot is written, and the saved Email row populates gtm columns
    // (not featureLine/fitAngle).
    mockResolveProfile.mockResolvedValue({
      ...mockProfile,
      resumeText: "AE at YC fintech. Closed 6 pilots, $240k ARR.",
      ws: { targetRole: "gtm" },
    });
    const gtmDossier = {
      summary: "Series B AI SDR, hiring GTM",
      triggers: ["Series B led by Accel in March 2026"],
      recentMoves: [],
      marketSignals: [],
    };
    mockResearchCompanyDossierGtm.mockResolvedValue(gtmDossier);
    mockPickGtmAngle.mockResolvedValue({
      triggerLine: "Series B led by Accel in March 2026",
      proofOfMotion: "my pipeline build at the YC fintech",
    });
    const lead = makeUserLead({
      company: { ...makeUserLead().company, researchDossier: null, researchedAt: null },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.company.update.mockResolvedValue({});
    mockPrisma.email.create.mockResolvedValue({ id: "email-gtm-1" });

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1", save: true });

    // Eng pipeline must not be touched.
    expect(mockResearchCompanyDossier).not.toHaveBeenCalled();
    expect(mockPickFitAngle).not.toHaveBeenCalled();
    // GTM pipeline runs end-to-end.
    expect(mockResearchCompanyDossierGtm).toHaveBeenCalledOnce();
    expect(mockPickGtmAngle).toHaveBeenCalledOnce();
    expect(mockPickGtmAngle.mock.calls[0][0].dossier).toEqual(gtmDossier);

    // DraftInput carries GTM personalization, not eng.
    const draftInput = mockGenerateEmailDraft.mock.calls[0][0];
    expect(draftInput.featureLine).toBeNull();
    expect(draftInput.fitAngle).toBeNull();
    expect(draftInput.triggerLine).toBe("Series B led by Accel in March 2026");
    expect(draftInput.proofOfMotion).toBe("my pipeline build at the YC fintech");
    expect(draftInput.targetRole).toBe("gtm");

    // Cache write lands in the gtm slot (not engineering).
    const updateArg = mockPrisma.company.update.mock.calls[0][0];
    expect(updateArg.data.researchDossier.gtm).toEqual({
      dossier: gtmDossier,
      researchedAt: expect.any(Date),
    });
    expect(updateArg.data.researchDossier.engineering).toBeNull();

    // Saved Email row populates gtm* columns, not featureLine/fitAngle.
    const emailArg = mockPrisma.email.create.mock.calls[0][0];
    expect(emailArg.data.gtmTriggerLine).toBe("Series B led by Accel in March 2026");
    expect(emailArg.data.gtmProofOfMotion).toBe("my pipeline build at the YC fintech");
    expect(emailArg.data.featureLine).toBeNull();
    expect(emailArg.data.fitAngle).toBeNull();
  });

  it("dispatches to the ops pipeline when workspace targetRole is operations", async () => {
    // ADR-0005 slice 3 dispatch contract: when targetRole resolves to
    // 'operations', the orchestrator routes to pickOpsAngle (not pickFitAngle
    // or pickGtmAngle), research goes through the ops hybrid (not eng or
    // GTM hybrid), the ops cache slot is written, and the saved Email row
    // populates opsInflectionLine/opsSystemBuilt (not any other role's
    // columns).
    mockResolveProfile.mockResolvedValue({
      ...mockProfile,
      resumeText: "Chief of Staff to CEO at a 30-person seed startup. Scaled hiring eng team 4 to 14.",
      ws: { targetRole: "operations" },
    });
    const opsDossier = {
      summary: "Post-Series-A SaaS scaling fast, hiring across functions",
      inflections: ["headcount doubling but no Head of People visible"],
      recentHires: ["Sara Park as VP Engineering"],
      openRoles: ["Head of People", "Senior Recruiter", "Finance Manager"],
    };
    mockResearchCompanyDossierOps.mockResolvedValue(opsDossier);
    mockPickOpsAngle.mockResolvedValue({
      inflectionLine: "headcount doubling but no Head of People visible",
      systemBuilt: "my first-Head-of-People build at the 12-person SaaS",
    });
    const lead = makeUserLead({
      company: { ...makeUserLead().company, researchDossier: null, researchedAt: null },
    });
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.company.update.mockResolvedValue({});
    mockPrisma.email.create.mockResolvedValue({ id: "email-ops-1" });

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1", save: true });

    // Eng + GTM pipelines must not be touched.
    expect(mockResearchCompanyDossier).not.toHaveBeenCalled();
    expect(mockPickFitAngle).not.toHaveBeenCalled();
    expect(mockResearchCompanyDossierGtm).not.toHaveBeenCalled();
    expect(mockPickGtmAngle).not.toHaveBeenCalled();
    // Ops pipeline runs end-to-end.
    expect(mockResearchCompanyDossierOps).toHaveBeenCalledOnce();
    expect(mockPickOpsAngle).toHaveBeenCalledOnce();
    expect(mockPickOpsAngle.mock.calls[0][0].dossier).toEqual(opsDossier);

    // DraftInput carries ops personalization, not eng or GTM.
    const draftInput = mockGenerateEmailDraft.mock.calls[0][0];
    expect(draftInput.featureLine).toBeNull();
    expect(draftInput.fitAngle).toBeNull();
    expect(draftInput.triggerLine).toBeNull();
    expect(draftInput.proofOfMotion).toBeNull();
    expect(draftInput.inflectionLine).toBe("headcount doubling but no Head of People visible");
    expect(draftInput.systemBuilt).toBe("my first-Head-of-People build at the 12-person SaaS");
    expect(draftInput.targetRole).toBe("operations");

    // Cache write lands in the ops slot.
    const updateArg = mockPrisma.company.update.mock.calls[0][0];
    expect(updateArg.data.researchDossier.operations).toEqual({
      dossier: opsDossier,
      researchedAt: expect.any(Date),
    });
    expect(updateArg.data.researchDossier.engineering).toBeNull();
    expect(updateArg.data.researchDossier.gtm).toBeNull();

    // Saved Email row populates ops* columns only.
    const emailArg = mockPrisma.email.create.mock.calls[0][0];
    expect(emailArg.data.opsInflectionLine).toBe("headcount doubling but no Head of People visible");
    expect(emailArg.data.opsSystemBuilt).toBe("my first-Head-of-People build at the 12-person SaaS");
    expect(emailArg.data.featureLine).toBeNull();
    expect(emailArg.data.fitAngle).toBeNull();
    expect(emailArg.data.gtmTriggerLine).toBeNull();
    expect(emailArg.data.gtmProofOfMotion).toBeNull();
  });

  it("custom contact path skips dossier + pick entirely", async () => {
    mockPrisma.customContact.findUnique.mockResolvedValue({
      id: "cc-1",
      userId: USER_ID,
      name: "Jordan",
      title: null,
      companyName: "Startup Co",
    });

    await generateDraft({ userId: USER_ID, customContactId: "cc-1" });

    expect(mockResearchCompanyDossier).not.toHaveBeenCalled();
    expect(mockPickFitAngle).not.toHaveBeenCalled();
  });
});

describe("generateDraft — save flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.email.findFirst.mockReset();
    mockPrisma.email.create.mockReset();
    mockPrisma.$executeRaw.mockReset();
    mockPrisma.$transaction.mockReset();
    mockPrisma.email.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockResolveProfile.mockResolvedValue(mockProfile);
    mockBuildContext.mockReturnValue("sender context string");
    mockGenerateEmailDraft.mockResolvedValue(mockDraft);
    mockResearchCompanyDossier.mockResolvedValue({ summary: "", surfaces: [], recentLaunches: [], technicalAreas: [] });
    mockPickFitAngle.mockResolvedValue({ featureLine: null, fitAngle: null });
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

  it("returns an existing draft without generating a duplicate", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.email.findFirst.mockResolvedValue({
      id: "email-existing",
      subject: "Existing subject",
      body: "Existing body",
    });

    const result = await generateDraft({ userId: USER_ID, userLeadId: "lead-1", save: true });

    expect(mockGenerateEmailDraft).not.toHaveBeenCalled();
    expect(mockPrisma.email.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      emailId: "email-existing",
      subject: "Existing subject",
      body: "Existing body",
    });
  });

  it("rechecks for an existing draft inside the save transaction", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.email.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "email-raced",
        subject: "Raced subject",
        body: "Raced body",
      });

    const result = await generateDraft({ userId: USER_ID, userLeadId: "lead-1", save: true });

    expect(mockGenerateEmailDraft).toHaveBeenCalledOnce();
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
    expect(mockPrisma.email.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      emailId: "email-raced",
      subject: "Raced subject",
      body: "Raced body",
    });
  });

  it("saves template attachmentIds onto generated draft records", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockPrisma.template.findUnique.mockResolvedValue({
      id: "tmpl-files",
      userId: USER_ID,
      subject: "Hello",
      body: "Hi {{firstName}}",
      verbatim: true,
      attachmentIds: ["resume", "file-1"],
    });
    mockPrisma.email.create.mockResolvedValue({ id: "email-with-files" });

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1", templateId: "tmpl-files", save: true });

    const createArg = mockPrisma.email.create.mock.calls[0][0];
    expect(createArg.data.attachmentIds).toEqual(["resume", "file-1"]);
  });

  it("defaults saved generated drafts to the uploaded resume attachment", async () => {
    const lead = makeUserLead();
    mockPrisma.userLead.findUnique.mockResolvedValue(lead);
    mockResolveProfile.mockResolvedValue({
      ...mockProfile,
      ws: { resumePath: `${USER_ID}/resume.pdf`, resumeFileName: "resume.pdf" },
    });
    mockPrisma.email.create.mockResolvedValue({ id: "email-resume-default" });

    await generateDraft({ userId: USER_ID, userLeadId: "lead-1", save: true });

    const createArg = mockPrisma.email.create.mock.calls[0][0];
    expect(createArg.data.attachmentIds).toEqual(["resume"]);
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
