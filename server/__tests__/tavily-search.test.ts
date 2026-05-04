import { describe, it, expect, vi, beforeEach } from "vitest";
import { tavilySearch } from "../lib/ai/tavily-search.js";

const API_KEY = "tv-test-key";

beforeEach(() => {
  vi.unstubAllGlobals();
});

function mockTavily(payload: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(""),
    json: () => Promise.resolve(payload),
  });
}

describe("tavilySearch", () => {
  it("returns normalized results from a Tavily response", async () => {
    vi.stubGlobal(
      "fetch",
      mockTavily({
        results: [
          { title: "Acme product", url: "https://acme.ai/product", content: "Acme builds X." },
          { title: "Acme blog post", url: "https://acme.ai/blog/y", content: "Recently launched Y." },
        ],
      })
    );

    const out = await tavilySearch({ query: "acme.ai product launches", apiKey: API_KEY });

    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toEqual({
      title: "Acme product",
      url: "https://acme.ai/product",
      content: "Acme builds X.",
    });
  });

  it("posts to https://api.tavily.com/search with the API key in the body", async () => {
    const fetchMock = mockTavily({ results: [] });
    vi.stubGlobal("fetch", fetchMock);

    await tavilySearch({ query: "acme.ai", apiKey: API_KEY, maxResults: 5 });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body as string);
    expect(body.api_key).toBe(API_KEY);
    expect(body.query).toBe("acme.ai");
    expect(body.max_results).toBe(5);
  });

  it("defaults max_results to 5 and search_depth to advanced", async () => {
    const fetchMock = mockTavily({ results: [] });
    vi.stubGlobal("fetch", fetchMock);

    await tavilySearch({ query: "acme.ai", apiKey: API_KEY });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.max_results).toBe(5);
    expect(body.search_depth).toBe("advanced");
  });

  it("uses caller-supplied searchDepth when provided", async () => {
    const fetchMock = mockTavily({ results: [] });
    vi.stubGlobal("fetch", fetchMock);

    await tavilySearch({ query: "acme.ai", apiKey: API_KEY, searchDepth: "basic" });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.search_depth).toBe("basic");
  });

  it("returns an empty result list when the API responds with 429 (rate limited)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve("rate limited"),
      })
    );

    const out = await tavilySearch({ query: "acme.ai", apiKey: API_KEY });

    expect(out.results).toEqual([]);
  });

  it("returns an empty result list when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const out = await tavilySearch({ query: "acme.ai", apiKey: API_KEY });

    expect(out.results).toEqual([]);
  });

  it("throws on 401 (invalid API key) so misconfiguration surfaces", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("invalid api key"),
      })
    );

    await expect(tavilySearch({ query: "acme.ai", apiKey: API_KEY })).rejects.toThrow(/Tavily.*401/);
  });

  it("throws on 403 (forbidden) so quota/permission issues surface", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("forbidden"),
      })
    );

    await expect(tavilySearch({ query: "acme.ai", apiKey: API_KEY })).rejects.toThrow(/Tavily.*403/);
  });

  it("logs a warning when 5xx response occurs (server-side failure)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve("upstream down"),
      })
    );

    const out = await tavilySearch({ query: "acme.ai", apiKey: API_KEY });

    expect(out.results).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("filters out malformed result entries", async () => {
    vi.stubGlobal(
      "fetch",
      mockTavily({
        results: [
          { title: "good", url: "https://x.com", content: "hi" },
          { title: 42 }, // bad shape
          null,
          { url: "https://y.com" }, // missing title/content
        ],
      })
    );

    const out = await tavilySearch({ query: "x", apiKey: API_KEY });

    expect(out.results).toHaveLength(1);
    expect(out.results[0].title).toBe("good");
  });
});
