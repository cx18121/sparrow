import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGetUserId, mockGetSupabaseAdmin, tx, mockTransaction } = vi.hoisted(() => {
  const mockGetUserId = vi.fn<[], Promise<string | null>>();
  const mockGetSupabaseAdmin = vi.fn();
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
  return { mockGetUserId, mockGetSupabaseAdmin, tx, mockTransaction };
});

vi.mock("../lib/supabaseAdmin.js", () => ({
  getUserIdFromRequest: mockGetUserId,
  getSupabaseAdmin: mockGetSupabaseAdmin,
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: { $transaction: mockTransaction },
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

function makeAdmin(profileError: unknown = null, authError: unknown = null) {
  const deleteFn = vi.fn().mockReturnThis();
  const eq = vi.fn().mockResolvedValue({ error: profileError });
  return {
    from: vi.fn(() => ({ delete: deleteFn, eq })),
    auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ error: authError }) } },
  };
}

describe("account route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const model of Object.values(tx)) model.deleteMany.mockResolvedValue({ count: 0 });
    mockTransaction.mockImplementation(async fn => fn(tx));
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
    const admin = makeAdmin();
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
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(userId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("returns 500 when profile cleanup fails", async () => {
    mockGetUserId.mockResolvedValue("user-1");
    mockGetSupabaseAdmin.mockReturnValue(makeAdmin({ message: "profile failed" }));
    const res = makeRes();

    await handler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to delete account" });
  });
});
