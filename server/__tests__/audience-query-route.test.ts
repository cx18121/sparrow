import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGetUserId, mockPrisma } = vi.hoisted(() => {
  const mockGetUserId = vi.fn<() => Promise<string | null>>();
  const mockPrisma = {
    company: { count: vi.fn(), findMany: vi.fn() },
    userLead: { findMany: vi.fn() },
  };
  return { mockGetUserId, mockPrisma };
});

vi.mock("../lib/supabaseAdmin.js", () => ({ getUserIdFromRequest: mockGetUserId }));
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

import handler from "../routes/audience-query.js";

function makeReq(overrides: Record<string, unknown> = {}) {
  return { method: "POST", headers: {}, body: null, query: {}, ...overrides } as unknown as VercelRequest;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserId.mockResolvedValue("user-1");
  mockPrisma.userLead.findMany.mockResolvedValue([]);
  mockPrisma.company.count.mockResolvedValue(0);
  mockPrisma.company.findMany.mockResolvedValue([]);
});

describe("POST /audience-query", () => {
  it("returns 400 on invalid JSON body", async () => {
    const req = makeReq({ body: "not-json{{{" });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid JSON body" });
    expect(mockPrisma.company.count).not.toHaveBeenCalled();
  });

  it("accepts a JSON string body", async () => {
    const req = makeReq({
      body: JSON.stringify({ audience: { tags: [], region: null, stage: null, batch: null, isHiring: null } }),
    });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ count: 0, sample: [] });
  });
});
