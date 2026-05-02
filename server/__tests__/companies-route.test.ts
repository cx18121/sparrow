import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGetUserId, mockPrisma } = vi.hoisted(() => {
  const mockGetUserId = vi.fn<[], Promise<string | null>>();
  const mockPrisma = {
    company: {
      findMany: vi.fn(),
    },
    discoverySeenCompany: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    userLead: {
      findMany: vi.fn(),
    },
  };
  return { mockGetUserId, mockPrisma };
});

vi.mock("../lib/supabaseAdmin.js", () => ({
  getUserIdFromRequest: mockGetUserId,
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: mockPrisma,
}));

// companies.ts imports groupTagsByNamespace from scripts/_lib/tags.js — pure function, let it through

import handler from "../routes/companies.js";

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

const USER_ID = "user-companies-test";

describe("companies route — GET auth check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without userId", async () => {
    mockGetUserId.mockResolvedValue(null);
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });
});

describe("companies route — GET pagination and filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns paginated list of verified companies", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const companies = [
      { id: "co-1", name: "Acme", domain: "acme.com", isVerified: true },
      { id: "co-2", name: "Beta", domain: "beta.io", isVerified: true },
    ];
    mockPrisma.company.findMany.mockResolvedValue(companies);
    const req = makeReq({ method: "GET", query: { limit: "2" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.items).toHaveLength(2);
    expect(jsonArg.nextCursor).toBeNull();
  });

  it("returns nextCursor when there are more items than limit", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    // Return limit+1 to trigger hasMore
    const companies = Array.from({ length: 3 }, (_, i) => ({ id: `co-${i}`, name: `Co ${i}`, isVerified: true }));
    mockPrisma.company.findMany.mockResolvedValue(companies);
    const req = makeReq({ method: "GET", query: { limit: "2" } });
    const res = makeRes();
    await handler(req, res);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.items).toHaveLength(2);
    expect(jsonArg.nextCursor).toBe("co-1");
  });

  it("passes region filter param to prisma query", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.company.findMany.mockResolvedValue([]);
    const req = makeReq({ method: "GET", query: { region: "Bay Area" } });
    const res = makeRes();
    await handler(req, res);
    const findManyCall = mockPrisma.company.findMany.mock.calls[0][0];
    expect(findManyCall.where.region).toBe("Bay Area");
  });

  it("passes search filter param to prisma query", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.company.findMany.mockResolvedValue([]);
    const req = makeReq({ method: "GET", query: { search: "Acme" } });
    const res = makeRes();
    await handler(req, res);
    const findManyCall = mockPrisma.company.findMany.mock.calls[0][0];
    expect(findManyCall.where.name).toEqual({ startsWith: "Acme", mode: "insensitive" });
  });

  it("always includes isVerified:true in the query", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.company.findMany.mockResolvedValue([]);
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    const findManyCall = mockPrisma.company.findMany.mock.calls[0][0];
    expect(findManyCall.where.isVerified).toBe(true);
  });

  it("passes minScore filter to prisma query", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.company.findMany.mockResolvedValue([]);
    const req = makeReq({ method: "GET", query: { minScore: "50" } });
    const res = makeRes();
    await handler(req, res);
    const findManyCall = mockPrisma.company.findMany.mock.calls[0][0];
    expect(findManyCall.where.qualityScore).toEqual({ gte: 50 });
  });

  it("handles cursor pagination param", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.company.findMany.mockResolvedValue([]);
    const req = makeReq({ method: "GET", query: { cursor: "co-5" } });
    const res = makeRes();
    await handler(req, res);
    const findManyCall = mockPrisma.company.findMany.mock.calls[0][0];
    expect(findManyCall.cursor).toEqual({ id: "co-5" });
    expect(findManyCall.skip).toBe(1);
  });
});

describe("companies route — DELETE (reset discovery seen)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes discovery seen records and returns 200", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.discoverySeenCompany.deleteMany.mockResolvedValue({ count: 5 });
    const req = makeReq({ method: "DELETE" });
    const res = makeRes();
    await handler(req, res);
    expect(mockPrisma.discoverySeenCompany.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ reset: true });
  });

  it("returns 405 for unsupported methods", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "POST" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
