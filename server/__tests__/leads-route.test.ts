import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGetUserId, mockPrisma, mockRevealAndUpsert } = vi.hoisted(() => {
  const mockGetUserId = vi.fn<[], Promise<string | null>>();
  const mockPrisma = {
    userLead: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
    contact: {
      findUnique: vi.fn(),
    },
  };
  const mockRevealAndUpsert = vi.fn();
  return { mockGetUserId, mockPrisma, mockRevealAndUpsert };
});

vi.mock("../lib/supabaseAdmin.js", () => ({
  getUserIdFromRequest: mockGetUserId,
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("../lib/apollo-enrichment.js", () => ({
  revealAndUpsertContact: mockRevealAndUpsert,
}));

import handler from "../routes/leads.js";

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

/**
 * Invoke handler, swallowing HttpError so we can check res.status() was called.
 * The leads handler uses `return create(...)` without `await`, so HttpErrors
 * bubble past the try/catch and reach the caller.
 */
async function invokeHandler(req: VercelRequest, res: ReturnType<typeof makeRes>) {
  try {
    await handler(req, res as any);
  } catch (err: any) {
    // If the error has a status, it's an HttpError — apply it to res
    if (err && typeof err.status === "number") {
      res.status(err.status).json({ error: err.message });
    } else {
      throw err;
    }
  }
}

const USER_ID = "user-abc-123";

describe("leads route — GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without userId", async () => {
    mockGetUserId.mockResolvedValue(null);
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("lists leads for user with pagination", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const leads = [
      { id: "lead-1", userId: USER_ID, companyId: "co-1" },
      { id: "lead-2", userId: USER_ID, companyId: "co-2" },
    ];
    mockPrisma.userLead.findMany.mockResolvedValue(leads);
    const req = makeReq({ method: "GET", query: { limit: "2" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.items).toHaveLength(2);
    expect(jsonArg.nextCursor).toBeNull();
  });

  it("supports cursor pagination — returns nextCursor when there are more items", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const leads = Array.from({ length: 3 }, (_, i) => ({ id: `lead-${i}`, userId: USER_ID }));
    mockPrisma.userLead.findMany.mockResolvedValue(leads);
    const req = makeReq({ method: "GET", query: { limit: "2" } });
    const res = makeRes();
    await invokeHandler(req, res);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.items).toHaveLength(2);
    expect(jsonArg.nextCursor).toBe("lead-1");
  });

  it("filters by status", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.userLead.findMany.mockResolvedValue([]);
    const req = makeReq({ method: "GET", query: { status: "SAVED" } });
    const res = makeRes();
    await invokeHandler(req, res);
    const findManyCall = mockPrisma.userLead.findMany.mock.calls[0][0];
    expect(findManyCall.where.status).toBe("SAVED");
  });
});

describe("leads route — POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when companyId missing", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "POST", body: {} });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "companyId is required" });
  });

  it("returns 404 when company not found", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.company.findUnique.mockResolvedValue(null);
    const req = makeReq({ method: "POST", body: { companyId: "nonexistent-co" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Company not found" });
  });

  it("creates a lead and returns 201", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.company.findUnique.mockResolvedValue({ id: "co-1" });
    mockPrisma.userLead.findFirst.mockResolvedValue(null);
    const newLead = { id: "lead-new", userId: USER_ID, companyId: "co-1", status: "SAVED" };
    mockPrisma.userLead.create.mockResolvedValue(newLead);
    const req = makeReq({ method: "POST", body: { companyId: "co-1" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(newLead);
  });

  it("returns 200 when lead already exists (updates instead)", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.company.findUnique.mockResolvedValue({ id: "co-1" });
    const existing = { id: "lead-existing", userId: USER_ID, companyId: "co-1" };
    mockPrisma.userLead.findFirst.mockResolvedValue(existing);
    const updated = { ...existing, notes: "updated notes" };
    mockPrisma.userLead.update.mockResolvedValue(updated);
    const req = makeReq({ method: "POST", body: { companyId: "co-1", notes: "updated notes" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(updated);
  });
});

describe("leads route — PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when id missing", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "PATCH", body: {} });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "id is required" });
  });

  it("returns 400 for invalid status", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "PATCH", body: { id: "lead-1", status: "INVALID_STATUS" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when lead not found or owned by different user", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.userLead.findUnique.mockResolvedValue({ id: "lead-1", userId: "other-user" });
    const req = makeReq({ method: "PATCH", body: { id: "lead-1", status: "SAVED" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Lead not found" });
  });

  it("updates status and notes", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const existing = { id: "lead-1", userId: USER_ID };
    mockPrisma.userLead.findUnique.mockResolvedValue(existing);
    const updated = { ...existing, status: "EMAILED", notes: "sent follow-up" };
    mockPrisma.userLead.update.mockResolvedValue(updated);
    const req = makeReq({ method: "PATCH", body: { id: "lead-1", status: "EMAILED", notes: "sent follow-up" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(updated);
  });
});

describe("leads route — DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when id query param missing", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "DELETE", query: {} });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "id query param is required" });
  });

  it("returns 404 when lead not found", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.userLead.findUnique.mockResolvedValue(null);
    const req = makeReq({ method: "DELETE", query: { id: "no-such-lead" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("deletes and returns 204", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.userLead.findUnique.mockResolvedValue({ id: "lead-1", userId: USER_ID });
    mockPrisma.userLead.delete.mockResolvedValue({});
    const req = makeReq({ method: "DELETE", query: { id: "lead-1" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(mockPrisma.userLead.delete).toHaveBeenCalledWith({ where: { id: "lead-1" } });
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});
