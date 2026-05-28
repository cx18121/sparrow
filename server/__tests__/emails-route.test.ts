import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGetUserId, mockPrisma } = vi.hoisted(() => {
  const mockGetUserId = vi.fn<() => Promise<string | null>>();
  const mockPrisma = {
    email: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userLead: {
      findUnique: vi.fn(),
    },
    customContact: {
      findUnique: vi.fn(),
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

import handler from "../routes/emails.js";

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
 * The emails handler uses `return create(...)` without `await`, so HttpErrors
 * bubble past the try/catch and reach the caller.
 */
async function invokeHandler(req: VercelRequest, res: ReturnType<typeof makeRes>) {
  try {
    await handler(req, res as any);
  } catch (err: any) {
    if (err && typeof err.status === "number") {
      res.status(err.status).json({ error: err.message });
    } else {
      throw err;
    }
  }
}

const USER_ID = "user-emails-test";

describe("emails route — GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without userId", async () => {
    mockGetUserId.mockResolvedValue(null);
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns paginated list", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const emails = [
      { id: "email-1", subject: "Hello", body: "World", createdAt: new Date("2024-01-02") },
      { id: "email-2", subject: "Hi", body: "There", createdAt: new Date("2024-01-01") },
    ];
    // list() runs two parallel findMany calls (userLead branch, then customContact branch)
    mockPrisma.email.findMany
      .mockResolvedValueOnce(emails) // userLead query
      .mockResolvedValueOnce([]);    // customContact query
    const req = makeReq({ method: "GET", query: { limit: "2" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.items).toHaveLength(2);
    expect(jsonArg.nextCursor).toBeNull();
  });

  it("returns 400 for invalid status filter", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "GET", query: { status: "INVALID" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("scopes by campaignId via the userLead.campaignLeads relation", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.email.findMany.mockResolvedValueOnce([
      { id: "email-camp-1", subject: "From this campaign", body: "x", createdAt: new Date() },
    ]);
    const req = makeReq({ method: "GET", query: { campaignId: "cmp-1", status: "draft" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    // Single query (not the two-branch fan-out) with the campaignLeads filter applied.
    expect(mockPrisma.email.findMany).toHaveBeenCalledTimes(1);
    const callArg = mockPrisma.email.findMany.mock.calls[0][0];
    expect(callArg.where).toMatchObject({
      userLead: { userId: USER_ID, campaignLeads: { some: { campaignId: "cmp-1" } } },
      status: "draft",
    });
    // Custom-contact drafts are not fetched at all when campaign-scoped.
    expect(callArg.where).not.toHaveProperty("customContact");
  });
});

describe("emails route — POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when neither userLeadId nor customContactId provided", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "POST", body: { subject: "Hi", body: "Hello" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "userLeadId or customContactId is required" });
  });

  it("returns 404 when lead not found", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.userLead.findUnique.mockResolvedValue(null);
    const req = makeReq({ method: "POST", body: { userLeadId: "no-such-lead", subject: "Hi", body: "Hello" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Lead not found" });
  });

  it("creates email from lead and returns 201", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.userLead.findUnique.mockResolvedValue({ id: "lead-1", userId: USER_ID, contactId: "contact-1" });
    const newEmail = { id: "email-new", userLeadId: "lead-1", subject: "Hello", body: "Body", status: "draft" };
    mockPrisma.email.create.mockResolvedValue(newEmail);
    const req = makeReq({ method: "POST", body: { userLeadId: "lead-1", subject: "Hello", body: "Body" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(newEmail);
  });

  it("creates email from customContact and returns 201", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.customContact.findUnique.mockResolvedValue({ id: "cc-1", userId: USER_ID });
    const newEmail = { id: "email-new2", customContactId: "cc-1", subject: "Hi", body: "Body2", status: "draft" };
    mockPrisma.email.create.mockResolvedValue(newEmail);
    const req = makeReq({ method: "POST", body: { customContactId: "cc-1", subject: "Hi", body: "Body2" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(newEmail);
  });
});

describe("emails route — PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when id missing", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "PATCH", body: { subject: "New" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "id is required" });
  });

  it("returns 404 when email not found", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.email.findUnique.mockResolvedValue(null);
    const req = makeReq({ method: "PATCH", body: { id: "no-email", subject: "Hi" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("updates subject/body/status", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email-1",
      userLead: { userId: USER_ID },
      customContact: null,
    });
    const updated = { id: "email-1", subject: "New Subject", body: "New Body", status: "sent" };
    mockPrisma.email.update.mockResolvedValue(updated);
    const req = makeReq({ method: "PATCH", body: { id: "email-1", subject: "New Subject", body: "New Body", status: "sent" } });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(updated);
  });
});

describe("emails route — content size limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserId.mockResolvedValue(USER_ID);
  });

  it("rejects an oversized body on create before any DB write", async () => {
    const req = makeReq({
      method: "POST",
      body: { userLeadId: "lead-1", subject: "Hi", body: "x".repeat(100_001) },
    });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    // The cheap length check must short-circuit ahead of the ownership lookup.
    expect(mockPrisma.userLead.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.email.create).not.toHaveBeenCalled();
  });

  it("rejects an oversized subject on create", async () => {
    const req = makeReq({
      method: "POST",
      body: { userLeadId: "lead-1", subject: "x".repeat(2_001), body: "ok" },
    });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.email.create).not.toHaveBeenCalled();
  });

  it("rejects an oversized body on update before the ownership lookup", async () => {
    const req = makeReq({
      method: "PATCH",
      body: { id: "email-1", body: "x".repeat(100_001) },
    });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.email.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.email.update).not.toHaveBeenCalled();
  });

  it("accepts a body exactly at the limit", async () => {
    mockPrisma.userLead.findUnique.mockResolvedValue({ id: "lead-1", userId: USER_ID, contactId: null });
    mockPrisma.email.create.mockResolvedValue({ id: "email-1" });
    const req = makeReq({
      method: "POST",
      body: { userLeadId: "lead-1", subject: "Hi", body: "x".repeat(100_000) },
    });
    const res = makeRes();
    await invokeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
