import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateEmailDraft } from "../_lib/ai/generate-email.js";
import type { GenerateEmailParams } from "../_lib/ai/types.js";

const API_KEY = "test-key";

const baseParams: GenerateEmailParams = {
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
  userTemplate: null,
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

describe("generateEmailDraft", () => {
  it("returns subject and body", async () => {
    vi.stubGlobal("fetch", makeAnthropicMock("Hi Sarah, I wanted to reach out about Acme AI."));
    const draft = await generateEmailDraft(baseParams);
    expect(draft.subject).toBeTruthy();
    expect(draft.body).toBeTruthy();
  });

  it("uses default subject template when subjectTemplate is null", async () => {
    vi.stubGlobal("fetch", makeAnthropicMock("Hi Sarah, reaching out."));
    const draft = await generateEmailDraft(baseParams);
    expect(draft.subject).toBe("Quick intro — Alex");
  });

  it("uses custom subject template", async () => {
    vi.stubGlobal("fetch", makeAnthropicMock("Hi Sarah, reaching out."));
    const draft = await generateEmailDraft({ ...baseParams, subjectTemplate: "Hey from {{senderName}}" });
    expect(draft.subject).toBe("Hey from Alex");
  });

  it("calls Anthropic API twice — once for generation, once for humanizer", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah, reaching out.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft(baseParams);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes interest hook in user prompt when hook provided", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah, loved your post on scaling infra.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft({ ...baseParams, interestHook: "your post on scaling infra" });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.messages[0].content).toContain("your post on scaling infra");
  });

  it("instructs AI not to invent interests when hook is null", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft({ ...baseParams, interestHook: null });
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
    await expect(generateEmailDraft(baseParams)).rejects.toThrow("Anthropic API 429");
  });

  it("includes company context in the prompt", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft(baseParams);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("Acme AI");
    expect(prompt).toContain("Series A");
  });

  it("includes senderContext in the prompt", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft(baseParams);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("Name: Alex");
  });

  it("passes the API key to both Anthropic calls", async () => {
    const fetchMock = makeAnthropicMock("Hi Sarah.");
    vi.stubGlobal("fetch", fetchMock);
    await generateEmailDraft({ ...baseParams, apiKey: "user-api-key-xyz" });
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
    const draft = await generateEmailDraft(baseParams);
    expect(draft.body).toBe("Humanized body");
  });

  describe("verbatim template mode", () => {
    it("returns template body verbatim without calling Anthropic", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const draft = await generateEmailDraft({
        ...baseParams,
        userTemplate: "Hi {{firstName}}, I wanted to reach out about {{company}}.",
        subjectTemplate: "Hello from {{senderName}}",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(draft.body).toBe("Hi Sarah, I wanted to reach out about Acme AI.");
      expect(draft.subject).toBe("Hello from Alex");
    });

    it("substitutes all supported variables in template body", async () => {
      vi.stubGlobal("fetch", vi.fn());
      const draft = await generateEmailDraft({
        ...baseParams,
        userTemplate: "{{firstName}} {{senderName}} {{company}} {{company_name}} {{companyName}}",
      });
      expect(draft.body).toBe("Sarah Alex Acme AI Acme AI Acme AI");
    });

    it("leaves unrecognised placeholders unchanged", async () => {
      vi.stubGlobal("fetch", vi.fn());
      const draft = await generateEmailDraft({
        ...baseParams,
        userTemplate: "Hi {{firstName}}, re: {{unknownVar}}",
      });
      expect(draft.body).toBe("Hi Sarah, re: {{unknownVar}}");
    });
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
    const draft = await generateEmailDraft(baseParams);
    expect(draft.body).toBe("Raw generated body");
  });
});
