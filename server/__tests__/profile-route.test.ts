import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGetUserId, mockGetSupabaseAdmin, mockEncrypt } = vi.hoisted(() => {
  const mockGetUserId = vi.fn<[], Promise<string | null>>();
  const mockGetSupabaseAdmin = vi.fn();
  const mockEncrypt = vi.fn((s: string) => `encrypted:${s}`);
  return { mockGetUserId, mockGetSupabaseAdmin, mockEncrypt };
});

vi.mock("../lib/supabaseAdmin.js", () => ({
  getUserIdFromRequest: mockGetUserId,
  getSupabaseAdmin: mockGetSupabaseAdmin,
}));

vi.mock("../lib/crypto.js", () => ({
  encrypt: mockEncrypt,
}));

import handler from "../routes/profile.js";

// --- Helpers ---

function makeReq(overrides: Record<string, unknown> = {}) {
  return { method: "GET", headers: {}, body: null, query: {}, ...overrides } as unknown as VercelRequest;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

function makeSupabaseChain(selectResult: { data: unknown; error: unknown }, upsertResult?: { error: unknown }) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(selectResult);
  chain.upsert = vi.fn().mockResolvedValue(upsertResult ?? { error: null });
  return chain;
}

describe("profile route — GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no userId", async () => {
    mockGetUserId.mockResolvedValue(null);
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("returns { profile: null } for non-UUID userId", async () => {
    mockGetUserId.mockResolvedValue("not-a-uuid");
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ profile: null });
  });

  it("returns profile shape with hasClaudeKey/hasGoogleRefreshToken when data exists", async () => {
    mockGetUserId.mockResolvedValue(VALID_UUID);
    const chain = makeSupabaseChain({
      data: {
        user_id: VALID_UUID,
        workspace_config: { theme: "dark" },
        default_filters: {},
        resume_path: "/path/to/resume.pdf",
        resume_text: "My resume",
        onboarding_completed: true,
        onboarding_completed_at: "2024-01-01T00:00:00Z",
        google_refresh_token_encrypted: "someToken",
        updated_at: "2024-01-01T00:00:00Z",
      },
      error: null,
    });
    mockGetSupabaseAdmin.mockReturnValue(chain);
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = res.json.mock.calls[0][0];
    // hasClaudeKey mirrors only deployment env capability.
    expect(jsonArg.profile.hasClaudeKey).toBe(!!process.env.ANTHROPIC_API_KEY);
    expect(jsonArg.profile.hasGoogleRefreshToken).toBe(true);
    expect(jsonArg.profile.workspaceConfig).toEqual({ theme: "dark" });
  });

  it("returns host capability profile when no DB row", async () => {
    mockGetUserId.mockResolvedValue(VALID_UUID);
    const chain = makeSupabaseChain({ data: null, error: null });
    mockGetSupabaseAdmin.mockReturnValue(chain);
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.profile.workspaceConfig).toEqual({});
    expect(jsonArg.profile.hasClaudeKey).toBe(!!process.env.ANTHROPIC_API_KEY?.trim());
    expect(jsonArg.profile.hasGoogleRefreshToken).toBe(false);
  });

  it("returns 500 on Supabase error", async () => {
    mockGetUserId.mockResolvedValue(VALID_UUID);
    const chain = makeSupabaseChain({ data: null, error: { message: "DB failure" } });
    mockGetSupabaseAdmin.mockReturnValue(chain);
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Could not load profile" });
  });
});

describe("profile route — POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no userId", async () => {
    mockGetUserId.mockResolvedValue(null);
    const req = makeReq({ method: "POST", body: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 on invalid JSON body (string that is not JSON)", async () => {
    mockGetUserId.mockResolvedValue(VALID_UUID);
    const chain = makeSupabaseChain({ data: null, error: null });
    mockGetSupabaseAdmin.mockReturnValue(chain);
    const req = makeReq({ method: "POST", body: "not-valid-json{{{" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid JSON body" });
  });

  it("upserts workspaceConfig field", async () => {
    mockGetUserId.mockResolvedValue(VALID_UUID);
    const chain = makeSupabaseChain({ data: null, error: null }, { error: null });
    mockGetSupabaseAdmin.mockReturnValue(chain);
    const config = { theme: "light", lang: "en" };
    const req = makeReq({ method: "POST", body: { workspaceConfig: config } });
    const res = makeRes();
    await handler(req, res);
    expect(chain.upsert).toHaveBeenCalledOnce();
    const upsertArg = chain.upsert.mock.calls[0][0];
    expect(upsertArg.workspace_config).toEqual(config);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("ignores client-supplied claudeApiKey writes", async () => {
    mockGetUserId.mockResolvedValue(VALID_UUID);
    const chain = makeSupabaseChain({ data: null, error: null }, { error: null });
    mockGetSupabaseAdmin.mockReturnValue(chain);
    const req = makeReq({ method: "POST", body: { claudeApiKey: "sk-ant-my-key", workspaceConfig: {} } });
    const res = makeRes();
    await handler(req, res);
    expect(mockEncrypt).not.toHaveBeenCalledWith("sk-ant-my-key");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("returns 500 on Supabase upsert error", async () => {
    mockGetUserId.mockResolvedValue(VALID_UUID);
    const chain = makeSupabaseChain({ data: null, error: null }, { error: { message: "upsert failed" } });
    mockGetSupabaseAdmin.mockReturnValue(chain);
    const req = makeReq({ method: "POST", body: { workspaceConfig: {} } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Could not save profile" });
  });
});

describe("profile route — unsupported methods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PUT returns 405", async () => {
    mockGetUserId.mockResolvedValue(VALID_UUID);
    const chain = makeSupabaseChain({ data: null, error: null });
    mockGetSupabaseAdmin.mockReturnValue(chain);
    const req = makeReq({ method: "PUT" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("DELETE returns 405", async () => {
    mockGetUserId.mockResolvedValue(VALID_UUID);
    const chain = makeSupabaseChain({ data: null, error: null });
    mockGetSupabaseAdmin.mockReturnValue(chain);
    const req = makeReq({ method: "DELETE" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
