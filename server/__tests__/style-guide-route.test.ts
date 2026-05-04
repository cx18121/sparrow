import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGetUserId, mockResolveProfile, mockCallClaude } = vi.hoisted(() => ({
  mockGetUserId: vi.fn<[], Promise<string | null>>(),
  mockResolveProfile: vi.fn(),
  mockCallClaude: vi.fn(),
}));

vi.mock("../lib/supabaseAdmin.js", () => ({
  getUserIdFromRequest: mockGetUserId,
}));

vi.mock("../lib/sender-profile.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/sender-profile.js")>("../lib/sender-profile.js");
  return {
    ...actual,
    resolveProfileForGeneration: mockResolveProfile,
  };
});

vi.mock("../lib/ai/anthropic.js", () => ({
  callClaude: mockCallClaude,
}));

import handler from "../routes/style-guide.js";
import { ProfileError } from "../lib/sender-profile.js";

function makeReq(overrides: Record<string, unknown> = {}) {
  return { method: "POST", headers: {}, body: null, query: {}, ...overrides } as unknown as VercelRequest;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res as VercelResponse & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

describe("style-guide route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserId.mockResolvedValue("user-1");
    mockResolveProfile.mockResolvedValue({ apiKey: "host-key" });
    mockCallClaude.mockResolvedValue("Use short, concrete emails with a direct ask.");
  });

  it("allows only POST requests", async () => {
    const res = makeRes();

    await handler(makeReq({ method: "GET" }), res);

    expect(res.setHeader).toHaveBeenCalledWith("Allow", "POST");
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: "Method not allowed" });
  });

  it("requires an authenticated user", async () => {
    mockGetUserId.mockResolvedValue(null);
    const res = makeRes();

    await handler(makeReq({ body: { examples: ["Hi there"] } }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it("returns sanitized 500 JSON when auth lookup fails", async () => {
    mockGetUserId.mockRejectedValue(new Error("Supabase unavailable"));
    const res = makeRes();

    await expect(handler(makeReq({ body: { examples: ["Hi there"] } }), res)).resolves.not.toThrow();

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON bodies", async () => {
    const res = makeRes();

    await handler(makeReq({ body: "{" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid JSON body" });
  });

  it("requires at least one non-empty example string", async () => {
    const res = makeRes();

    await handler(makeReq({ body: { examples: ["", "   ", 42] } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "No valid example strings provided" });
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it("passes up to six valid examples to Claude and returns the generated guide", async () => {
    const res = makeRes();
    const examples = ["One", "", "Two", "Three", "Four", "Five", "Six", "Seven"];

    await handler(makeReq({ body: { examples } }), res);

    expect(mockResolveProfile).toHaveBeenCalledWith("user-1");
    expect(mockCallClaude).toHaveBeenCalledOnce();
    const claudeInput = mockCallClaude.mock.calls[0][0];
    expect(claudeInput.apiKey).toBe("host-key");
    expect(claudeInput.maxTokens).toBe(200);
    expect(claudeInput.userContent).toContain("Here are 6 email samples");
    expect(claudeInput.userContent).toContain("Example 6:\nSix");
    expect(claudeInput.userContent).not.toContain("Seven");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ guide: "Use short, concrete emails with a direct ask." });
  });

  it("returns profile configuration errors directly", async () => {
    mockResolveProfile.mockRejectedValue(new ProfileError("Email generation is not configured on this deployment. Contact the host.", 500));
    const res = makeRes();

    await handler(makeReq({ body: { examples: ["Hi there"] } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Email generation is not configured on this deployment. Contact the host.",
    });
  });

  it("returns 502 when Claude generation fails", async () => {
    mockCallClaude.mockRejectedValue(new Error("provider down"));
    const res = makeRes();

    await handler(makeReq({ body: { examples: ["Hi there"] } }), res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: "Could not generate style guide" });
  });

  it("returns 500 when Claude returns an empty guide", async () => {
    mockCallClaude.mockResolvedValue("");
    const res = makeRes();

    await handler(makeReq({ body: { examples: ["Hi there"] } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Empty response from Claude" });
  });
});
