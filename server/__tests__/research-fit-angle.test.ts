import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  researchCompanyDossier,
  researchCompanyDossierOpsHybrid,
  pickFitAngle,
  parseCachedDossierEnvelope,
  getDossierSlot,
  setDossierSlot,
  parseGtmDossier,
  isEmptyGtmDossier,
  parseOpsDossier,
  isEmptyOpsDossier,
  type CompanyDossier,
} from "../lib/ai/research-fit-angle.js";

const ANTHROPIC_KEY = "ant-test-key";
const TAVILY_KEY = "tv-test-key";
const API_KEY = ANTHROPIC_KEY;

const baseCompany = {
  name: "Acme AI",
  description: "AI ops platform that auto-tunes inference costs",
  oneLiner: "The OS for AI ops",
  stage: "Series A",
  industry: "Enterprise SaaS",
  isHiring: true,
  domain: "acme.ai" as string | null,
};

const SAMPLE_TAVILY = {
  results: [
    {
      title: "Acme AI Product",
      url: "https://acme.ai/product",
      content: "Acme AI ships an inference cost optimizer that auto-tunes serving for enterprise teams. Recently launched per-tenant cost dashboards.",
    },
    {
      title: "Acme blog: model router",
      url: "https://acme.ai/blog/router",
      content: "Our model router cuts cost across multi-model deployments by routing cheaper queries to smaller models.",
    },
  ],
};

// Helper: mock a Claude-only fetch (used by pickFitAngle tests).
function mockClaudeText(text: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(""),
    json: () =>
      Promise.resolve({ content: [{ type: "text", text }] }),
  });
}

// Mocks the Tavily POST and the subsequent Claude POST. Tavily fetch matches
// /api.tavily.com/, Claude fetch matches /api.anthropic.com/.
function mockTavilyAndClaude(tavilyPayload: unknown, claudeText: string) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("tavily.com")) {
      return {
        ok: true,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve(tavilyPayload),
      };
    }
    return {
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({ content: [{ type: "text", text: claudeText }] }),
    };
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("researchCompanyDossier (Tavily + Claude synthesis)", () => {
  const dossierJson = JSON.stringify({
    summary: "AI inference cost optimizer for enterprise teams.",
    surfaces: ["the inference cost optimizer", "the model router"],
    recentLaunches: ["per-tenant cost dashboards"],
    technicalAreas: ["multi-model routing"],
  });

  it("calls Tavily first to gather raw search results", async () => {
    const fetchMock = mockTavilyAndClaude(SAMPLE_TAVILY, dossierJson);
    vi.stubGlobal("fetch", fetchMock);

    await researchCompanyDossier({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      tavilyApiKey: TAVILY_KEY,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tavilyUrl, tavilyOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tavilyUrl).toBe("https://api.tavily.com/search");
    const tavilyBody = JSON.parse(tavilyOpts.body as string);
    expect(tavilyBody.api_key).toBe(TAVILY_KEY);
    expect(tavilyBody.query).toContain("Acme AI");
  });

  it("requests max_tokens >= 2048 from Claude so JSON output is not truncated", async () => {
    const fetchMock = mockTavilyAndClaude(SAMPLE_TAVILY, dossierJson);
    vi.stubGlobal("fetch", fetchMock);

    await researchCompanyDossier({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      tavilyApiKey: TAVILY_KEY,
    });

    const [, claudeOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    const claudeBody = JSON.parse(claudeOpts.body as string);
    expect(claudeBody.max_tokens).toBeGreaterThanOrEqual(2048);
  });

  it("logs a warning when Claude response has text but parses as empty (likely truncated JSON)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Truncated JSON — model started emitting but ran out of tokens mid-array.
    const truncated = '{"summary":"AI ops platform","surfaces":["the inference cost optimizer", "the';
    vi.stubGlobal("fetch", mockTavilyAndClaude(SAMPLE_TAVILY, truncated));

    const dossier = await researchCompanyDossier({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      tavilyApiKey: TAVILY_KEY,
    });

    expect(dossier.surfaces).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("then calls Claude (no tools) with the Tavily results to synthesize the dossier", async () => {
    const fetchMock = mockTavilyAndClaude(SAMPLE_TAVILY, dossierJson);
    vi.stubGlobal("fetch", fetchMock);

    await researchCompanyDossier({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      tavilyApiKey: TAVILY_KEY,
    });

    const [claudeUrl, claudeOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(claudeUrl).toBe("https://api.anthropic.com/v1/messages");
    const claudeBody = JSON.parse(claudeOpts.body as string);
    expect(claudeBody.tools).toBeUndefined();
    const userContent = claudeBody.messages[0].content as string;
    expect(userContent).toContain("Acme AI");
    expect(userContent).toContain("https://acme.ai/product");
    expect(userContent).toContain("inference cost optimizer that auto-tunes serving");
  });

  it("returns the synthesized dossier", async () => {
    vi.stubGlobal("fetch", mockTavilyAndClaude(SAMPLE_TAVILY, dossierJson));

    const dossier = await researchCompanyDossier({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      tavilyApiKey: TAVILY_KEY,
    });

    expect(dossier.summary).toContain("inference cost");
    expect(dossier.surfaces).toContain("the inference cost optimizer");
    expect(dossier.recentLaunches).toContain("per-tenant cost dashboards");
  });

  it("returns an empty dossier and skips the Claude call when Tavily returns no results", async () => {
    const fetchMock = mockTavilyAndClaude({ results: [] }, dossierJson);
    vi.stubGlobal("fetch", fetchMock);

    const dossier = await researchCompanyDossier({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      tavilyApiKey: TAVILY_KEY,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1); // only Tavily, no Claude
    expect(dossier.surfaces).toEqual([]);
    expect(dossier.summary).toBe("");
  });

  it("returns an empty dossier when tavilyApiKey is missing (research disabled)", async () => {
    const fetchMock = mockTavilyAndClaude(SAMPLE_TAVILY, dossierJson);
    vi.stubGlobal("fetch", fetchMock);

    const dossier = await researchCompanyDossier({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      tavilyApiKey: null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dossier.surfaces).toEqual([]);
  });

  it("returns an empty dossier when Claude response is not valid JSON", async () => {
    vi.stubGlobal("fetch", mockTavilyAndClaude(SAMPLE_TAVILY, "Sorry, I could not find anything."));

    const dossier = await researchCompanyDossier({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      tavilyApiKey: TAVILY_KEY,
    });

    expect(dossier.surfaces).toEqual([]);
    expect(dossier.summary).toBe("");
  });

  it("extracts JSON from a Claude response that wraps it in prose", async () => {
    const wrapped =
      "Here's the dossier:\n```json\n" +
      JSON.stringify({ summary: "Y Combinator-backed.", surfaces: ["the YC dashboard"], recentLaunches: [], technicalAreas: [] }) +
      "\n```\nLet me know if you need more.";
    vi.stubGlobal("fetch", mockTavilyAndClaude(SAMPLE_TAVILY, wrapped));

    const dossier = await researchCompanyDossier({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      tavilyApiKey: TAVILY_KEY,
    });

    expect(dossier.surfaces).toEqual(["the YC dashboard"]);
    expect(dossier.summary).toBe("Y Combinator-backed.");
  });
});

describe("pickFitAngle", () => {
  const dossier: CompanyDossier = {
    summary: "AI inference cost optimizer.",
    surfaces: ["the inference cost optimizer", "the model router"],
    recentLaunches: ["per-tenant cost dashboards"],
    technicalAreas: ["multi-model routing"],
  };

  it("returns featureLine and fitAngle from Claude response", async () => {
    vi.stubGlobal(
      "fetch",
      mockClaudeText("FEATURE: the inference cost optimizer\nFIT: my RAG cost telemetry project")
    );

    const result = await pickFitAngle({
      dossier,
      resumeText: "Built RAG cost telemetry pipeline",
      apiKey: API_KEY,
    });

    expect(result.featureLine).toBe("the inference cost optimizer");
    expect(result.fitAngle).toBe("my RAG cost telemetry project");
  });

  it("does NOT include any tools in the request (token-only call)", async () => {
    const fetchMock = mockClaudeText("FEATURE: x\nFIT: y");
    vi.stubGlobal("fetch", fetchMock);

    await pickFitAngle({
      dossier,
      resumeText: "resume",
      apiKey: API_KEY,
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.tools).toBeUndefined();
  });

  it("includes the dossier surfaces and the resume in the prompt", async () => {
    const fetchMock = mockClaudeText("FEATURE: the inference cost optimizer\nFIT: my project");
    vi.stubGlobal("fetch", fetchMock);

    await pickFitAngle({
      dossier,
      resumeText: "Built RAG cost telemetry. Hardware-accelerated routing prototype.",
      apiKey: API_KEY,
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("the inference cost optimizer");
    expect(prompt).toContain("multi-model routing");
    expect(prompt).toContain("RAG cost telemetry");
  });

  it("injects a role-family hint into the prompt when targetRole is set", async () => {
    // The whole point of role-aware fit-angle: a designer applying to a
    // company shouldn't get an infra-flavored fit picked just because
    // their resume mentions one infra project. The hint tilts the
    // tiebreaker toward function-relevant surfaces.
    const fetchMock = mockClaudeText("FEATURE: design system\nFIT: my design work");
    vi.stubGlobal("fetch", fetchMock);

    await pickFitAngle({
      dossier,
      resumeText: "resume",
      apiKey: API_KEY,
      targetRole: "product",
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toMatch(/product.*design/i);
  });

  it("omits the role hint when targetRole is null", async () => {
    // Backward-compat: callers that don't pass targetRole get the
    // pre-refactor prompt verbatim.
    const fetchMock = mockClaudeText("FEATURE: x\nFIT: y");
    vi.stubGlobal("fetch", fetchMock);

    await pickFitAngle({ dossier, resumeText: "resume", apiKey: API_KEY });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    // No role hint should appear; the "Candidate is targeting" preamble
    // only fires when a hint is provided.
    expect(prompt).not.toMatch(/Candidate is targeting/i);
  });

  it("returns nulls for both fields when Claude says NONE", async () => {
    vi.stubGlobal("fetch", mockClaudeText("FEATURE: NONE\nFIT: NONE"));

    const result = await pickFitAngle({ dossier, resumeText: "irrelevant", apiKey: API_KEY });

    expect(result.featureLine).toBeNull();
    expect(result.fitAngle).toBeNull();
  });

  it("skips the LLM call entirely and returns nulls when dossier is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const empty: CompanyDossier = {
      summary: "",
      surfaces: [],
      recentLaunches: [],
      technicalAreas: [],
    };
    const result = await pickFitAngle({ dossier: empty, resumeText: "resume", apiKey: API_KEY });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.featureLine).toBeNull();
    expect(result.fitAngle).toBeNull();
  });
});

describe("parseCachedDossierEnvelope — cache shape adapter (ADR-0005)", () => {
  const flatLegacy = {
    summary: "AI ops platform.",
    surfaces: ["the agent eval harness"],
    recentLaunches: [],
    technicalAreas: ["multi-agent orchestration"],
  };
  const legacyAt = new Date("2026-04-01T00:00:00.000Z");

  it("wraps a legacy flat dossier into the engineering slot with legacyAt", () => {
    const env = parseCachedDossierEnvelope(flatLegacy, legacyAt);
    expect(env.engineering).toEqual({ dossier: flatLegacy, researchedAt: legacyAt });
    expect(env.gtm).toBeNull();
    expect(env.operations).toBeNull();
  });

  it("falls back to epoch when legacyAt is null", () => {
    const env = parseCachedDossierEnvelope(flatLegacy, null);
    expect(env.engineering?.researchedAt.getTime()).toBe(0);
  });

  it("returns an envelope-shaped value through unchanged", () => {
    const recent = new Date("2026-05-19T12:00:00.000Z");
    const envelopeJson = {
      engineering: { dossier: flatLegacy, researchedAt: recent.toISOString() },
      gtm: null,
      operations: null,
    };
    const env = parseCachedDossierEnvelope(envelopeJson, null);
    expect(env.engineering?.dossier).toEqual(flatLegacy);
    expect(env.engineering?.researchedAt).toEqual(recent);
  });

  it("returns an empty envelope for null/undefined/non-object inputs", () => {
    const empty = { engineering: null, gtm: null, operations: null };
    expect(parseCachedDossierEnvelope(null, null)).toEqual(empty);
    expect(parseCachedDossierEnvelope(undefined, null)).toEqual(empty);
    expect(parseCachedDossierEnvelope("string", null)).toEqual(empty);
    expect(parseCachedDossierEnvelope(42, null)).toEqual(empty);
    expect(parseCachedDossierEnvelope([], null)).toEqual(empty);
  });

  it("returns an empty envelope when a legacy-looking row is missing required fields", () => {
    // parseFlatDossier rejects shapes that don't have all 4 required fields;
    // the discriminator should still classify as legacy attempt and fail
    // gracefully, not get misclassified as a stale envelope.
    const malformed = { summary: "ok", surfaces: "not-an-array" };
    expect(parseCachedDossierEnvelope(malformed, null)).toEqual({
      engineering: null,
      gtm: null,
      operations: null,
    });
  });

  it("prefers legacy classification when JSON positively looks flat, even with an incidental envelope key", () => {
    // Defensive: a legacy row that incidentally carries an `engineering`
    // field (shouldn't happen in practice — all live legacy rows came
    // from parseFlatDossier-conformant writes) must still classify as
    // legacy and wrap correctly, not get misclassified as an envelope.
    // Tightens against the discriminator's prior shape-absence heuristic.
    const odd = { ...flatLegacy, engineering: "junk" };
    const env = parseCachedDossierEnvelope(odd, legacyAt);
    expect(env.engineering?.dossier).toEqual(flatLegacy);
    expect(env.gtm).toBeNull();
  });
});

describe("getDossierSlot — role → slot mapping (ADR-0005)", () => {
  const slot = {
    dossier: { summary: "x", surfaces: ["s"], recentLaunches: [], technicalAreas: [] },
    researchedAt: new Date(),
  };
  const envelope = { engineering: slot, gtm: null, operations: null };

  it("maps engineering, product, and null to the engineering slot", () => {
    expect(getDossierSlot(envelope, "engineering")).toBe(slot);
    expect(getDossierSlot(envelope, "product")).toBe(slot);
    expect(getDossierSlot(envelope, null)).toBe(slot);
  });

  it("maps gtm to the gtm slot and operations to the operations slot", () => {
    // Each slot carries its role-shaped dossier per ADR-0005.
    const gtmSlot = {
      dossier: { summary: "g", triggers: ["t"], recentMoves: [], marketSignals: [] },
      researchedAt: new Date(),
    };
    const opsSlot = {
      dossier: { summary: "o", inflections: ["i"], recentHires: [], openRoles: [] },
      researchedAt: new Date(),
    };
    const full = { engineering: null, gtm: gtmSlot, operations: opsSlot };
    expect(getDossierSlot(full, "gtm")).toBe(gtmSlot);
    expect(getDossierSlot(full, "operations")).toBe(opsSlot);
  });
});

describe("setDossierSlot — read-modify-write helper (ADR-0005)", () => {
  const slotA = {
    dossier: { summary: "a", surfaces: ["a"], recentLaunches: [], technicalAreas: [] },
    researchedAt: new Date(),
  };
  // GTM slot uses GtmDossier shape per slice 2's typed envelope.
  const gtmSlot = {
    dossier: { summary: "g", triggers: ["t"], recentMoves: [], marketSignals: [] },
    researchedAt: new Date(),
  };

  it("replaces the target role's slot and preserves the others", () => {
    const before = { engineering: slotA, gtm: null, operations: null };
    const after = setDossierSlot(before, "gtm", gtmSlot);
    expect(after.engineering).toBe(slotA);
    expect(after.gtm).toBe(gtmSlot);
    expect(after.operations).toBeNull();
  });

  it("returns a new envelope without mutating the input", () => {
    const before = { engineering: slotA, gtm: null, operations: null };
    const snapshot = { ...before };
    setDossierSlot(before, "gtm", gtmSlot);
    expect(before).toEqual(snapshot);
  });

  it("product writes land in the engineering slot (shared pipeline)", () => {
    const before = { engineering: null, gtm: null, operations: null };
    const after = setDossierSlot(before, "product", slotA);
    expect(after.engineering).toBe(slotA);
  });
});

describe("parseGtmDossier — GTM dossier validator (ADR-0005 slice 2)", () => {
  const valid = {
    summary: "Series B fintech",
    triggers: ["raised $50M led by Accel"],
    recentMoves: ["acquired Stripe Atlas competitor"],
    marketSignals: ["sector consolidation accelerating"],
  };

  it("accepts a well-formed GtmDossier shape", () => {
    expect(parseGtmDossier(valid)).toEqual(valid);
  });

  it("returns null when summary is missing or wrong type", () => {
    expect(parseGtmDossier({ ...valid, summary: undefined })).toBeNull();
    expect(parseGtmDossier({ ...valid, summary: 42 })).toBeNull();
    expect(parseGtmDossier({ ...valid, summary: null })).toBeNull();
  });

  it("returns null when triggers is missing or not a string array", () => {
    expect(parseGtmDossier({ ...valid, triggers: undefined })).toBeNull();
    expect(parseGtmDossier({ ...valid, triggers: "not-an-array" })).toBeNull();
    expect(parseGtmDossier({ ...valid, triggers: [1, 2, 3] })).toBeNull();
  });

  it("returns null when recentMoves is missing or not a string array", () => {
    expect(parseGtmDossier({ ...valid, recentMoves: undefined })).toBeNull();
    expect(parseGtmDossier({ ...valid, recentMoves: { a: 1 } })).toBeNull();
  });

  it("returns null when marketSignals is missing or not a string array", () => {
    expect(parseGtmDossier({ ...valid, marketSignals: undefined })).toBeNull();
    expect(parseGtmDossier({ ...valid, marketSignals: [true] })).toBeNull();
  });

  it("returns null for null / non-object / array inputs", () => {
    expect(parseGtmDossier(null)).toBeNull();
    expect(parseGtmDossier(undefined)).toBeNull();
    expect(parseGtmDossier("string")).toBeNull();
    expect(parseGtmDossier(42)).toBeNull();
    expect(parseGtmDossier([])).toBeNull();
  });

  it("does not mistake a CompanyDossier (eng) shape for a valid GtmDossier", () => {
    // Defensive: a row that happens to have eng-shape keys passed in here
    // must NOT be accepted — the gtm slot parser rejects it cleanly so
    // the orchestrator falls through to a cache miss for the gtm role.
    const eng = {
      summary: "eng dossier",
      surfaces: ["s"],
      recentLaunches: [],
      technicalAreas: [],
    };
    expect(parseGtmDossier(eng)).toBeNull();
  });
});

describe("parseGtmSlot via parseCachedDossierEnvelope — GTM slot validation (ADR-0005 slice 2)", () => {
  // parseGtmSlot is internal to research-fit-angle.ts. Exercise it through
  // parseCachedDossierEnvelope so behavior is tested at the public boundary.
  const validGtmDossier = {
    summary: "Series B fintech",
    triggers: ["raised $50M"],
    recentMoves: [],
    marketSignals: [],
  };
  const validIso = new Date("2026-04-01T00:00:00.000Z").toISOString();

  it("parses a well-formed gtm slot from envelope JSON", () => {
    const env = parseCachedDossierEnvelope(
      {
        engineering: null,
        gtm: { dossier: validGtmDossier, researchedAt: validIso },
        operations: null,
      },
      null,
    );
    expect(env.gtm?.dossier).toEqual(validGtmDossier);
    expect(env.gtm?.researchedAt.toISOString()).toBe(validIso);
  });

  it("returns null gtm slot when dossier is missing required GTM fields", () => {
    const env = parseCachedDossierEnvelope(
      {
        engineering: null,
        gtm: {
          // Wrong shape — eng fields, not GTM. parseGtmSlot must reject.
          dossier: { summary: "x", surfaces: ["s"], recentLaunches: [], technicalAreas: [] },
          researchedAt: validIso,
        },
        operations: null,
      },
      null,
    );
    expect(env.gtm).toBeNull();
    expect(env.engineering).toBeNull();
  });

  it("returns null gtm slot when researchedAt is missing or invalid", () => {
    const env1 = parseCachedDossierEnvelope(
      {
        engineering: null,
        gtm: { dossier: validGtmDossier },
        operations: null,
      },
      null,
    );
    expect(env1.gtm).toBeNull();

    const env2 = parseCachedDossierEnvelope(
      {
        engineering: null,
        gtm: { dossier: validGtmDossier, researchedAt: "not-a-date" },
        operations: null,
      },
      null,
    );
    expect(env2.gtm).toBeNull();
  });

  it("returns null gtm slot when slot value itself is malformed", () => {
    const cases: unknown[] = ["string", 42, [], null];
    for (const malformed of cases) {
      const env = parseCachedDossierEnvelope(
        { engineering: null, gtm: malformed, operations: null },
        null,
      );
      expect(env.gtm).toBeNull();
    }
  });
});

describe("isEmptyGtmDossier — emptiness predicate (ADR-0005 slice 2)", () => {
  it("returns true when all three list fields are empty", () => {
    expect(isEmptyGtmDossier({ summary: "any", triggers: [], recentMoves: [], marketSignals: [] })).toBe(true);
    expect(isEmptyGtmDossier({ summary: "", triggers: [], recentMoves: [], marketSignals: [] })).toBe(true);
  });

  it("returns false when any list has content (summary alone is not enough — empty cache guard)", () => {
    expect(isEmptyGtmDossier({ summary: "", triggers: ["t"], recentMoves: [], marketSignals: [] })).toBe(false);
    expect(isEmptyGtmDossier({ summary: "", triggers: [], recentMoves: ["r"], marketSignals: [] })).toBe(false);
    expect(isEmptyGtmDossier({ summary: "", triggers: [], recentMoves: [], marketSignals: ["m"] })).toBe(false);
  });
});

describe("parseOpsDossier — ops dossier validator (ADR-0005 slice 3)", () => {
  const valid = {
    summary: "Post-Series-A SaaS, scaling fast",
    inflections: ["headcount doubling but no Head of People"],
    recentHires: ["Sara Park as VP Engineering"],
    openRoles: ["Head of People", "Finance Manager"],
  };

  it("accepts a well-formed OpsDossier shape", () => {
    expect(parseOpsDossier(valid)).toEqual(valid);
  });

  it("returns null when summary is missing or wrong type", () => {
    expect(parseOpsDossier({ ...valid, summary: undefined })).toBeNull();
    expect(parseOpsDossier({ ...valid, summary: 42 })).toBeNull();
  });

  it("returns null when any list field is missing or not a string array", () => {
    expect(parseOpsDossier({ ...valid, inflections: undefined })).toBeNull();
    expect(parseOpsDossier({ ...valid, inflections: "no" })).toBeNull();
    expect(parseOpsDossier({ ...valid, recentHires: [1, 2] })).toBeNull();
    expect(parseOpsDossier({ ...valid, openRoles: [true] })).toBeNull();
  });

  it("returns null for null / non-object / array inputs", () => {
    expect(parseOpsDossier(null)).toBeNull();
    expect(parseOpsDossier(undefined)).toBeNull();
    expect(parseOpsDossier("string")).toBeNull();
    expect(parseOpsDossier([])).toBeNull();
  });

  it("does not mistake a CompanyDossier (eng) or GtmDossier shape for a valid OpsDossier", () => {
    // Defensive cross-shape isolation: each parser should reject the
    // other roles' shapes so the orchestrator cache-misses cleanly when
    // a slot's stored shape doesn't match what its parser expects.
    const eng = { summary: "e", surfaces: [], recentLaunches: [], technicalAreas: [] };
    const gtm = { summary: "g", triggers: [], recentMoves: [], marketSignals: [] };
    expect(parseOpsDossier(eng)).toBeNull();
    expect(parseOpsDossier(gtm)).toBeNull();
  });
});

describe("parseOpsSlot via parseCachedDossierEnvelope — ops slot validation (ADR-0005 slice 3)", () => {
  const validOpsDossier = {
    summary: "scaling",
    inflections: ["no head of people"],
    recentHires: [],
    openRoles: [],
  };
  const validIso = new Date("2026-05-01T00:00:00.000Z").toISOString();

  it("parses a well-formed ops slot from envelope JSON", () => {
    const env = parseCachedDossierEnvelope(
      {
        engineering: null,
        gtm: null,
        operations: { dossier: validOpsDossier, researchedAt: validIso },
      },
      null,
    );
    expect(env.operations?.dossier).toEqual(validOpsDossier);
    expect(env.operations?.researchedAt.toISOString()).toBe(validIso);
  });

  it("returns null ops slot when dossier is wrong shape (eng or gtm)", () => {
    const wrong = parseCachedDossierEnvelope(
      {
        engineering: null,
        gtm: null,
        operations: {
          dossier: { summary: "x", surfaces: ["s"], recentLaunches: [], technicalAreas: [] },
          researchedAt: validIso,
        },
      },
      null,
    );
    expect(wrong.operations).toBeNull();
  });
});

describe("isEmptyOpsDossier — emptiness predicate (ADR-0005 slice 3)", () => {
  it("returns true when all three list fields are empty regardless of summary", () => {
    expect(isEmptyOpsDossier({ summary: "any", inflections: [], recentHires: [], openRoles: [] })).toBe(true);
    expect(isEmptyOpsDossier({ summary: "", inflections: [], recentHires: [], openRoles: [] })).toBe(true);
  });

  it("returns false when any list has content", () => {
    expect(isEmptyOpsDossier({ summary: "", inflections: ["i"], recentHires: [], openRoles: [] })).toBe(false);
    expect(isEmptyOpsDossier({ summary: "", inflections: [], recentHires: ["r"], openRoles: [] })).toBe(false);
    expect(isEmptyOpsDossier({ summary: "", inflections: [], recentHires: [], openRoles: ["o"] })).toBe(false);
  });
});

describe("researchCompanyDossierOpsHybrid — retrieval contract (ADR-0005 slice 3)", () => {
  // The ADR commits to "Exa /contents only, no /search arm" for ops
  // retrieval. Codex slice 3 review flagged this as untested at the unit
  // level. This suite pins the contract directly by inspecting which
  // Exa endpoint the function calls.
  const dossierJson = JSON.stringify({
    summary: "scaling SaaS",
    inflections: ["headcount doubling"],
    recentHires: [],
    openRoles: ["Head of People"],
  });

  it("hits Exa /contents and never /search when given an Exa key + domain", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("api.exa.ai/contents")) {
        return {
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({
            results: [
              { title: "Careers", url: "https://acme.ai/careers", text: "We're hiring across People, Eng, and Finance." },
            ],
          }),
        };
      }
      if (url.includes("api.anthropic.com")) {
        return {
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({ content: [{ type: "text", text: dossierJson }] }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await researchCompanyDossierOpsHybrid({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      exaApiKey: "exa-test-key",
      tavilyApiKey: null,
    });

    const urls = fetchMock.mock.calls.map(call => call[0] as string);
    // Contract: Exa /contents fired, Exa /search did NOT.
    expect(urls.some(u => u.includes("api.exa.ai/contents"))).toBe(true);
    expect(urls.some(u => u.includes("api.exa.ai/search"))).toBe(false);
  });

  it("falls back to Tavily when Exa /contents returns zero subpages", async () => {
    // The ADR amendment captures this fallback explicitly — ops retrieval
    // is "Exa /contents primary, Tavily fallback on 0 subpages", not
    // "Exa /contents only". Pin the fallback condition.
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("api.exa.ai/contents")) {
        return {
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({ results: [] }),
        };
      }
      if (url.includes("api.tavily.com")) {
        return {
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({
            results: [
              { title: "About", url: "https://acme.ai/about", content: "small team, hiring." },
            ],
          }),
        };
      }
      if (url.includes("api.anthropic.com")) {
        return {
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({ content: [{ type: "text", text: dossierJson }] }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await researchCompanyDossierOpsHybrid({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      exaApiKey: "exa-test-key",
      tavilyApiKey: TAVILY_KEY,
    });

    const urls = fetchMock.mock.calls.map(call => call[0] as string);
    expect(urls.some(u => u.includes("api.exa.ai/contents"))).toBe(true);
    expect(urls.some(u => u.includes("api.tavily.com"))).toBe(true);
    // Even on fallback, Exa /search is never called.
    expect(urls.some(u => u.includes("api.exa.ai/search"))).toBe(false);
  });

  it("falls back to Tavily when Exa /contents returns subpages but synthesis is empty (slice 4 thin-content)", async () => {
    // The "Notion problem" from the slice 3 smoke: Exa /contents returns
    // subpages, but they're thin enough that synthesis produces an empty
    // dossier. Without the slice 4 thin-content fallback, the empty
    // dossier would ship and the draft would have no operational anchor.
    // With the fallback, Tavily fires and gets a second chance.
    const emptyDossierJson = JSON.stringify({
      summary: "",
      inflections: [],
      recentHires: [],
      openRoles: [],
    });
    const richDossierJson = JSON.stringify({
      summary: "post-Series-A SaaS",
      inflections: ["headcount doubling"],
      recentHires: [],
      openRoles: ["Head of People"],
    });
    let claudeCallCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("api.exa.ai/contents")) {
        // Subpages exist but are thin.
        return {
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({
            results: [{ title: "About", url: "https://acme.ai/about", text: "We make software." }],
          }),
        };
      }
      if (url.includes("api.tavily.com")) {
        return {
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({
            results: [{ title: "Careers", url: "https://acme.ai/careers", content: "Hiring Head of People." }],
          }),
        };
      }
      if (url.includes("api.anthropic.com")) {
        claudeCallCount += 1;
        // First synthesis returns empty (thin /about), second returns rich (Tavily).
        const text = claudeCallCount === 1 ? emptyDossierJson : richDossierJson;
        return {
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({ content: [{ type: "text", text }] }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await researchCompanyDossierOpsHybrid({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      exaApiKey: "exa-test-key",
      tavilyApiKey: TAVILY_KEY,
    });

    const urls = fetchMock.mock.calls.map(call => call[0] as string);
    expect(urls.some(u => u.includes("api.exa.ai/contents"))).toBe(true);
    expect(urls.some(u => u.includes("api.tavily.com"))).toBe(true);
    // Synthesis ran twice (once for thin Exa, once for richer Tavily).
    expect(claudeCallCount).toBe(2);
    // Final dossier is the Tavily-backed rich one, not the empty Exa one.
    expect(result.inflections).toContain("headcount doubling");
  });

  it("skips the thin-content fallback when Tavily is unavailable (ships the empty dossier)", async () => {
    // Without Tavily, there's no fallback to fire. Ship the empty dossier
    // and let slotIsFresh catch it at the cache layer for the next call.
    const emptyDossierJson = JSON.stringify({
      summary: "",
      inflections: [],
      recentHires: [],
      openRoles: [],
    });
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("api.exa.ai/contents")) {
        return {
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({
            results: [{ title: "About", url: "https://acme.ai/about", text: "thin" }],
          }),
        };
      }
      if (url.includes("api.anthropic.com")) {
        return {
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({ content: [{ type: "text", text: emptyDossierJson }] }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await researchCompanyDossierOpsHybrid({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      exaApiKey: "exa-test-key",
      tavilyApiKey: null,
    });

    const urls = fetchMock.mock.calls.map(call => call[0] as string);
    expect(urls.some(u => u.includes("api.tavily.com"))).toBe(false);
    expect(result).toEqual({ summary: "", inflections: [], recentHires: [], openRoles: [] });
  });

  it("returns an empty dossier without calling Exa or Tavily when both keys are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await researchCompanyDossierOpsHybrid({
      company: baseCompany,
      apiKey: ANTHROPIC_KEY,
      exaApiKey: null,
      tavilyApiKey: null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ summary: "", inflections: [], recentHires: [], openRoles: [] });
  });
});
