import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateEmailDraft, substituteVariables } from "../lib/ai/generate-email.js";
import type { AiDraftInput, TemplateDraftInput, FallbackDraftInput } from "../lib/ai/types.js";

const API_KEY = "test-key";

const baseAi: AiDraftInput = {
  kind: "ai",
  contact: { name: "Sarah Chen", title: "Head of Engineering" },
  company: {
    name: "Acme AI",
    description: "AI-native ops platform",
    oneLiner: "The OS for AI ops",
    stage: "Series A",
    industry: "Enterprise SaaS",
    isHiring: true,
  },
  interestHook: null,
  senderContext: "Name: Alex, Looking for: SWE role",
  subjectTemplate: null,
  senderName: "Alex",
  apiKey: API_KEY,
};

function makeAnthropicMock(text: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(""),
    json: () =>
      Promise.resolve({ content: [{ type: "text", text }] }),
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("generateEmailDraft — AI mode", () => {
  it("returns subject and body", async () => {
    vi.stubGlobal("fetch", makeAnthropicMock("Hi Sarah, I wanted to reach out about Acme AI."));
    const draft = await generateEmailDraft(baseAi);
    expect(draft.subject).toBeTruthy();
    expect(draft.body).toBeTruthy();
  });

  it("uses default subject template when subjectTemplate is null", async () => {
    vi.stubGlobal("fetch", makeAnthropicMock("Hi Sarah, reaching out."));
    const draft = await generateEmailDraft(baseAi);
    expect(draft.subject).toBe("Interested in learning about Acme AI");
  });

  it("uses custom subject template", async () => {
    vi.stubGlobal("fetch", makeAnthropicMock("Hi Sarah, reaching out."));
    const draft = await generateEmailDraft({ ...baseAi, subjectTemplate: "Hey from {{senderName}}" });
    expect(draft.subject).toBe("Hey from Alex");
  });

  it("calls Anthropic API twice — once for generation, once for humanizer", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah, reaching out.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft(baseAi);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes interest hook in user prompt when hook provided", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah, loved your post on scaling infra.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft({ ...baseAi, interestHook: "your post on scaling infra" });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.messages[0].content).toContain("your post on scaling infra");
  });

  it("instructs AI not to invent interests when hook is null", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft({ ...baseAi, interestHook: null });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.messages[0].content).toContain("do not invent one");
  });

  it("omits personalization block when featureLine and fitAngle are both null", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft({ ...baseAi, featureLine: null, fitAngle: null });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).not.toContain("Personalization");
    expect(prompt).not.toContain("Feature to work on");
    expect(prompt).not.toContain("Resume angle");
  });

  it("includes only fitAngle line when featureLine is null", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft({
      ...baseAi,
      featureLine: null,
      fitAngle: "my distributed cache project",
    });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("my distributed cache project");
    expect(prompt).not.toContain("Feature to work on");
  });

  it("includes featureLine and fitAngle in the prompt when both provided", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah, …");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft({
      ...baseAi,
      featureLine: "the inference cost optimizer",
      fitAngle: "my RAG eval pipeline at Cornell",
    });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("the inference cost optimizer");
    expect(prompt).toContain("my RAG eval pipeline at Cornell");
  });

  it("throws when Anthropic returns non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve("rate limited"),
    }));
    await expect(generateEmailDraft(baseAi)).rejects.toThrow("Anthropic API 429");
  });

  it("includes company context in the prompt", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft(baseAi);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("Acme AI");
    expect(prompt).toContain("Series A");
  });

  it("includes senderContext in the prompt", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft(baseAi);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("Name: Alex");
  });

  it("passes the API key to both Anthropic calls", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft({ ...baseAi, apiKey: "user-api-key-xyz" });
    for (const call of fetchMock.mock.calls) {
      const [, options] = call as [string, RequestInit];
      expect((options.headers as Record<string, string>)["x-api-key"]).toBe("user-api-key-xyz");
    }
  });

  it("uses humanized body from second API call", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      const text = callCount === 1 ? "AI-drafted body" : "Humanized body";
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({ content: [{ type: "text", text }] }),
      });
    }));
    const draft = await generateEmailDraft(baseAi);
    expect(draft.body).toBe("Humanized body");
  });

  it("falls back to raw body when humanizer fails", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({ content: [{ type: "text", text: "Raw generated body" }] }),
        });
      }
      return Promise.resolve({ ok: false, status: 500 });
    }));
    const draft = await generateEmailDraft(baseAi);
    expect(draft.body).toBe("Raw generated body");
  });
});

describe("generateEmailDraft — Template mode (AI-personalized skeleton)", () => {
  const baseTemplate = {
    kind: "template",
    contact: baseAi.contact,
    company: baseAi.company,
    subjectTemplate: null,
    senderName: baseAi.senderName,
    body: "Hi {{firstName}}, I wanted to reach out about {{company}}.",
    senderContext: baseAi.senderContext,
    apiKey: API_KEY,
  } satisfies TemplateDraftInput;

  it("uses the substituted template body as an AI skeleton", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah, Acme AI's Series A caught my attention.");
    vi.stubGlobal("fetch", fetchMock);
    const draft = await generateEmailDraft({
      ...baseTemplate,
      subjectTemplate: "Hello from {{senderName}}",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("Template skeleton");
    expect(prompt).toContain("Hi Sarah, I wanted to reach out about Acme AI.");
    expect(prompt).toContain("Series A");
    expect(draft.body).toBe("Hi Sarah, Acme AI's Series A caught my attention.");
    expect(draft.subject).toBe("Hello from Alex");
  });

  it("substitutes all supported variables before passing the skeleton to AI", async () => {
    const fetchMock = makeAnthropicMock("Personalized body");
    vi.stubGlobal("fetch", fetchMock);
    const draft = await generateEmailDraft({
      ...baseTemplate,
      body: "{{firstName}} {{senderName}} {{company}} {{company_name}} {{companyName}}",
    });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.messages[0].content).toContain("Sarah Alex Acme AI Acme AI Acme AI");
    expect(draft.body).toBe("Personalized body");
  });

  it("forwards featureLine and fitAngle into the template personalization prompt", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah, …");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft({
      ...baseTemplate,
      featureLine: "the agent eval harness",
      fitAngle: "my multi-agent eval project",
    });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("the agent eval harness");
    expect(prompt).toContain("my multi-agent eval project");
  });

  it("keeps unrecognised placeholders out of the personalized draft", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah, re: Acme AI.");
    vi.stubGlobal("fetch", fetchMock);
    const draft = await generateEmailDraft({
      ...baseTemplate,
      body: "Hi {{firstName}}, re: {{unknownVar}}",
    });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.messages[0].content).toContain("Hi Sarah, re: [Company]");
    expect(draft.body).not.toContain("{{unknownVar}}");
  });
});

describe("generateEmailDraft — Verbatim mode", () => {
  it("returns the template body word-for-word with merge tags substituted, no Claude call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const draft = await generateEmailDraft({
      kind: "verbatim",
      contact: baseAi.contact,
      company: baseAi.company,
      subjectTemplate: "Quick thought on {{company}}",
      senderName: "Alex",
      body: "Hi {{first_name}}, I noticed {{company}} just shipped {{feature_line}}. {{fit_angle}} feels like a fit.\n\nBest,\n{{sender_name}}",
      featureLine: "the agent eval harness",
      fitAngle: "My multi-agent eval project",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(draft.subject).toBe("Quick thought on Acme AI");
    expect(draft.body).toBe(
      "Hi Sarah, I noticed Acme AI just shipped the agent eval harness. My multi-agent eval project feels like a fit.\n\nBest,\nAlex",
    );
  });

  it("drops paragraphs anchored on empty feature_line or fit_angle tags", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const draft = await generateEmailDraft({
      kind: "verbatim",
      contact: baseAi.contact,
      company: baseAi.company,
      subjectTemplate: "Hello {{first_name}}",
      senderName: "Alex",
      body: "Hi {{first_name}},\n\nSaw {{company}} just shipped {{feature_line}}.\n\nFor context, {{fit_angle}} feels like a fit.\n\nBest,\n{{sender_name}}",
      featureLine: null,
      fitAngle: null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(draft.body).toBe("Hi Sarah,\n\nBest,\nAlex");
  });
});

describe("substituteVariables — merge tags", () => {
  const contact = { name: "Sarah Chen", title: "Head of Engineering" };
  const company = { name: "Momentum AI" };

  it("fills snake_case and camelCase contact/sender/company tags", () => {
    const out = substituteVariables(
      "Hi {{first_name}} {{last_name}}, role: {{role}}, co: {{company}} / {{companyName}}, from {{sender_name}} ({{senderName}})",
      contact,
      "Alex Morgan",
      company,
    );
    expect(out).toBe("Hi Sarah Chen, role: Head of Engineering, co: Momentum AI / Momentum AI, from Alex Morgan (Alex Morgan)");
  });

  it("fills feature_line and fit_angle when AI metadata is provided", () => {
    const out = substituteVariables(
      "I noticed {{company}} just shipped {{feature_line}}. {{fit_angle}} feels like a fit.",
      contact,
      "Alex",
      company,
      { featureLine: "the agent eval harness", fitAngle: "My multi-agent eval project" },
    );
    expect(out).toBe(
      "I noticed Momentum AI just shipped the agent eval harness. My multi-agent eval project feels like a fit.",
    );
  });

  it("substitutes empty strings for feature_line/fit_angle when web research did not produce them", () => {
    const out = substituteVariables(
      "Saw {{feature_line}} — wanted to reach out.",
      contact,
      "Alex",
      company,
      { featureLine: null, fitAngle: null },
    );
    expect(out).toBe("Saw  — wanted to reach out.");
  });
});

describe("generateEmailDraft — Fallback mode", () => {
  const baseFallback: FallbackDraftInput = {
    kind: "fallback",
    contact: baseAi.contact,
    company: baseAi.company,
    subjectTemplate: null,
    senderName: baseAi.senderName,
  };

  it("returns generic fallback subject and body without calling Anthropic", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const draft = await generateEmailDraft(baseFallback);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(draft.subject).toBe("Quick intro");
    expect(draft.body).toContain("Sarah");
    expect(draft.body).toContain("Acme AI");
  });

  it("uses provided subjectTemplate when set instead of generic fallback subject", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const draft = await generateEmailDraft({
      ...baseFallback,
      subjectTemplate: "Custom fallback — {{senderName}}",
    });
    expect(draft.subject).toBe("Custom fallback — Alex");
  });

  it("uses 'there' when contact name is null", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const draft = await generateEmailDraft({
      ...baseFallback,
      contact: { name: null, title: null },
    });
    expect(draft.body).toContain("there");
  });
});
