import { describe, it, expect, vi, beforeEach } from "vitest";
import { callClaude } from "../lib/ai/anthropic.js";

const API_KEY = "test-key";

beforeEach(() => {
  vi.unstubAllGlobals();
});

function makeResponse(payload: unknown) {
  return {
    ok: true,
    text: () => Promise.resolve(""),
    json: () => Promise.resolve(payload),
  };
}

describe("callClaude — pause_turn continuation", () => {
  it("continues when stop_reason is pause_turn and returns the final-iteration text", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve(
          makeResponse({
            stop_reason: "pause_turn",
            content: [
              { type: "text", text: "Searching..." },
              {
                type: "server_tool_use",
                id: "srvtoolu_1",
                name: "web_search",
                input: { query: "Acme AI" },
              },
            ],
          })
        );
      }
      return Promise.resolve(
        makeResponse({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Final answer" }],
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callClaude({
      apiKey: API_KEY,
      model: "claude-haiku-4-5-20251001",
      userContent: "research it",
      maxTokens: 256,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
    });

    expect(result).toBe("Final answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves the prior assistant content when continuing", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve(
          makeResponse({
            stop_reason: "pause_turn",
            content: [{ type: "text", text: "thinking" }],
          })
        );
      }
      return Promise.resolve(
        makeResponse({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }],
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await callClaude({
      apiKey: API_KEY,
      model: "claude-haiku-4-5-20251001",
      userContent: "user prompt",
      maxTokens: 256,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
    });

    const secondCallBody = JSON.parse(
      (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string
    );
    expect(secondCallBody.messages).toHaveLength(2);
    expect(secondCallBody.messages[0]).toEqual({ role: "user", content: "user prompt" });
    expect(secondCallBody.messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "thinking" }],
    });
  });

  it("stops after 3 iterations to prevent infinite loops", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({
        stop_reason: "pause_turn",
        content: [{ type: "text", text: "still going" }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callClaude({
      apiKey: API_KEY,
      model: "claude-haiku-4-5-20251001",
      userContent: "loop bait",
      maxTokens: 256,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
    });

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
    expect(result).toBe("still going");
  });
});

describe("callClaude — error tolerance", () => {
  it("returns empty string when content has only error blocks (no text)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeResponse({
          stop_reason: "end_turn",
          content: [
            {
              type: "web_search_tool_result",
              tool_use_id: "srvtoolu_1",
              content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
            },
          ],
        })
      )
    );

    const result = await callClaude({
      apiKey: API_KEY,
      model: "claude-haiku-4-5-20251001",
      userContent: "x",
      maxTokens: 256,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
    });

    expect(result).toBe("");
  });
});
