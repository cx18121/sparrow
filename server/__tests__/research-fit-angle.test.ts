import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  researchCompanyDossier,
  pickFitAngle,
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
