import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const {
  mockGetUserId, mockGetSupabaseAdmin, tx, mockTransaction, mockDecrypt, mockRevokeToken,
} = vi.hoisted(() => {
  const mockGetUserId = vi.fn<() => Promise<string | null>>();
  const mockGetSupabaseAdmin = vi.fn();
  const mockDecrypt = vi.fn((value: string) => `decrypted:${value}`);
  const mockRevokeToken = vi.fn().mockResolvedValue(undefined);
  const tx = {
    email: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    campaignLead: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    campaignSeenCompany: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    discoverySeenCompany: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    dailyQuota: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    campaign: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    userLead: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    customContact: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    template: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  const mockTransaction = vi.fn(async (fn: (arg: typeof tx) => Promise<void>) => fn(tx));
  return { mockGetUserId, mockGetSupabaseAdmin, tx, mockTransaction, mockDecrypt, mockRevokeToken };
});

vi.mock("../lib/supabaseAdmin.js", () => ({
  getUserIdFromRequest: mockGetUserId,
  getSupabaseAdmin: mockGetSupabaseAdmin,
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: { $transaction: mockTransaction },
}));

vi.mock("../lib/crypto.js", () => ({
  decrypt: mockDecrypt,
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function OAuth2() {
        return { revokeToken: mockRevokeToken };
      }),
    },
  },
}));

import handler from "../routes/account.js";

function makeReq(overrides: Record<string, unknown> = {}) {
  return { method: "DELETE", headers: {}, body: null, query: {}, ...overrides } as unknown as VercelRequest;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as VercelResponse & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function makeAdmin({
  profileData = null,
  profileLoadError = null,
  profileDeleteError = null,
  authError = null,
}: {
  profileData?: unknown
  profileLoadError?: unknown
  profileDeleteError?: unknown
  authError?: unknown
} = {}) {
  const chain: any = { mode: "idle" };
  chain.select = vi.fn().mockImplementation(() => { chain.mode = "select"; return chain; });
  chain.delete = vi.fn().mockImplementation(() => { chain.mode = "delete"; return chain; });
  chain.eq = vi.fn().mockImplementation(() => (
    chain.mode === "select" ? chain : Promise.resolve({ error: profileDeleteError })
  ));
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: profileData, error: profileLoadError });
  return {
    from: vi.fn(() => chain),
    auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ error: authError }) } },
  };
}

describe("account route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const model of Object.values(tx)) model.deleteMany.mockResolvedValue({ count: 0 });
    mockTransaction.mockImplementation(async fn => fn(tx));
    mockDecrypt.mockImplementation((value: string) => `decrypted:${value}`);
    mockRevokeToken.mockResolvedValue(undefined);
  });

  it("returns 401 when the request has no user", async () => {
    mockGetUserId.mockResolvedValue(null);
    const res = makeRes();

    await handler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("deletes app rows, user profile, and auth user", async () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const admin = makeAdmin({
      profileData: { google_refresh_token_encrypted: "encrypted-refresh-token" },
    });
    mockGetUserId.mockResolvedValue(userId);
    mockGetSupabaseAdmin.mockReturnValue(admin);
    const res = makeRes();

    await handler(makeReq(), res);

    expect(tx.email.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { userLead: { userId } },
          { customContact: { userId } },
        ],
      },
    });
    expect(tx.campaign.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(tx.template.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(admin.from).toHaveBeenCalledWith("user_profiles");
    expect(mockDecrypt).toHaveBeenCalledWith("encrypted-refresh-token");
    expect(mockRevokeToken).toHaveBeenCalledWith("decrypted:encrypted-refresh-token");
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(userId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("continues deletion when Google grant revoke fails", async () => {
    mockGetUserId.mockResolvedValue("user-1");
    mockGetSupabaseAdmin.mockReturnValue(makeAdmin({
      profileData: { google_refresh_token_encrypted: "encrypted-refresh-token" },
    }));
    mockRevokeToken.mockRejectedValue(new Error("already revoked"));
    const res = makeRes();

    await handler(makeReq(), res);

    expect(mockRevokeToken).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 500 when profile cleanup fails", async () => {
    mockGetUserId.mockResolvedValue("user-1");
    mockGetSupabaseAdmin.mockReturnValue(makeAdmin({ profileDeleteError: { message: "profile failed" } }));
    const res = makeRes();

    await handler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to delete account" });
  });
});
