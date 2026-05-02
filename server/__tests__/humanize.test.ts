import { describe, it, expect, vi, beforeEach } from "vitest";
import { humanizeEmailBody } from "../lib/ai/humanize.js";

const API_KEY = "test-key-123";

function mockAnthropicOk(text: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      content: [{ type: "text", text }],
    }),
  }));
}

function mockAnthropicError(status = 500) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    status,
  }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("humanizeEmailBody", () => {
  it("returns humanized text from Anthropic response", async () => {
    mockAnthropicOk("Hi Jane, just wanted to reach out.");
    const result = await humanizeEmailBody("Hi Jane, I just wanted to reach out.", API_KEY);
    expect(result).toBe("Hi Jane, just wanted to reach out.");
  });

  it("returns original body when API returns non-ok status", async () => {
    mockAnthropicError(500);
    const original = "Hi Jane, I wanted to reach out.";
    const result = await humanizeEmailBody(original, API_KEY);
    expect(result).toBe(original);
  });

  it("returns original body when API returns empty text", async () => {
    mockAnthropicOk("");
    const original = "Hi Jane, I wanted to reach out.";
    const result = await humanizeEmailBody(original, API_KEY);
    expect(result).toBe(original);
  });

  it("returns original body when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const original = "Hi Jane, I wanted to reach out.";
    const result = await humanizeEmailBody(original, API_KEY);
    expect(result).toBe(original);
  });

  it("returns original body when content array is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }));
    const original = "Hi Jane, I wanted to reach out.";
    const result = await humanizeEmailBody(original, API_KEY);
    expect(result).toBe(original);
  });

  it("passes the API key in x-api-key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: [{ type: "text", text: "ok" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await humanizeEmailBody("some body", "my-secret-key");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["x-api-key"]).toBe("my-secret-key");
  });

  it("sends body text as user message content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: [{ type: "text", text: "ok" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const emailBody = "Hi Jane, this is a test email.";
    await humanizeEmailBody(emailBody, API_KEY);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(options.body as string);
    expect(requestBody.messages[0].content).toBe(emailBody);
  });

  it("trims whitespace from the returned text", async () => {
    mockAnthropicOk("  Hi Jane, just reached out.  ");
    const result = await humanizeEmailBody("original", API_KEY);
    expect(result).toBe("Hi Jane, just reached out.");
  });
});
