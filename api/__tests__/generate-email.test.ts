import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateEmailDraft } from "../_lib/ai/generate-email.js";
import type { AiDraftInput, TemplateDraftInput, FallbackDraftInput } from "../_lib/ai/types.js";

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
    expect(draft.subject).toBe("Quick intro — Alex");
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

describe("generateEmailDraft — Template mode (verbatim)", () => {
  const baseTemplate: TemplateDraftInput = {
    kind: "template",
    contact: baseAi.contact,
    company: baseAi.company,
    subjectTemplate: null,
    senderName: baseAi.senderName,
    body: "Hi {{firstName}}, I wanted to reach out about {{company}}.",
  };

  it("returns template body verbatim without calling Anthropic", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const draft = await generateEmailDraft({
      ...baseTemplate,
      subjectTemplate: "Hello from {{senderName}}",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(draft.body).toBe("Hi Sarah, I wanted to reach out about Acme AI.");
    expect(draft.subject).toBe("Hello from Alex");
  });

  it("substitutes all supported variables in template body", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const draft = await generateEmailDraft({
      ...baseTemplate,
      body: "{{firstName}} {{senderName}} {{company}} {{company_name}} {{companyName}}",
    });
    expect(draft.body).toBe("Sarah Alex Acme AI Acme AI Acme AI");
  });

  it("leaves unrecognised placeholders unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const draft = await generateEmailDraft({
      ...baseTemplate,
      body: "Hi {{firstName}}, re: {{unknownVar}}",
    });
    expect(draft.body).toBe("Hi Sarah, re: {{unknownVar}}");
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
