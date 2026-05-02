import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGetUserId, mockPrisma } = vi.hoisted(() => {
  const mockGetUserId = vi.fn<[], Promise<string | null>>();
  const mockPrisma = {
    campaign: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    template: {
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

import handler from "../routes/campaigns.js";

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

const USER_ID = "user-campaigns-test";

describe("campaigns route — GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without userId", async () => {
    mockGetUserId.mockResolvedValue(null);
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns list of user's campaigns", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const campaigns = [
      { id: "c-1", userId: USER_ID, name: "Campaign A", status: "DRAFT" },
      { id: "c-2", userId: USER_ID, name: "Campaign B", status: "ACTIVE" },
    ];
    mockPrisma.campaign.findMany.mockResolvedValue(campaigns);
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.items).toHaveLength(2);
  });

  it("filters campaigns by status", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.campaign.findMany.mockResolvedValue([]);
    const req = makeReq({ method: "GET", query: { status: "ACTIVE" } });
    const res = makeRes();
    await handler(req, res);
    const findManyCall = mockPrisma.campaign.findMany.mock.calls[0][0];
    expect(findManyCall.where.status).toBe("ACTIVE");
  });
});

describe("campaigns route — POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when name is missing", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "POST", body: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "name is required" });
  });

  it("returns 400 for invalid status", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "POST", body: { name: "My Campaign", status: "INVALID" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("creates campaign and returns 201", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const newCampaign = { id: "c-new", userId: USER_ID, name: "My Campaign", status: "DRAFT" };
    mockPrisma.campaign.create.mockResolvedValue(newCampaign);
    const req = makeReq({ method: "POST", body: { name: "My Campaign" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(newCampaign);
  });

  it("returns 404 when templateId is provided but template not found", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.template.findUnique.mockResolvedValue(null);
    const req = makeReq({ method: "POST", body: { name: "My Campaign", templateId: "no-template" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Template not found" });
  });
});

describe("campaigns route — PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when id is missing", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "PATCH", body: { name: "Updated" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "id is required" });
  });

  it("returns 404 when campaign not found", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.campaign.findUnique.mockResolvedValue(null);
    const req = makeReq({ method: "PATCH", body: { id: "no-campaign", name: "Updated" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Campaign not found" });
  });

  it("returns 404 when campaign belongs to different user", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.campaign.findUnique.mockResolvedValue({ id: "c-1", userId: "other-user" });
    const req = makeReq({ method: "PATCH", body: { id: "c-1", name: "Updated" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("updates campaign and returns 200", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.campaign.findUnique.mockResolvedValue({ id: "c-1", userId: USER_ID });
    const updated = { id: "c-1", userId: USER_ID, name: "Updated Campaign", status: "ACTIVE" };
    mockPrisma.campaign.update.mockResolvedValue(updated);
    const req = makeReq({ method: "PATCH", body: { id: "c-1", name: "Updated Campaign", status: "ACTIVE" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(updated);
  });
});

describe("campaigns route — DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when id query param is missing", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "DELETE", query: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "id query param is required" });
  });

  it("returns 404 when campaign not found", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.campaign.findUnique.mockResolvedValue(null);
    const req = makeReq({ method: "DELETE", query: { id: "no-c" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("deletes campaign and returns 204", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.campaign.findUnique.mockResolvedValue({ id: "c-1", userId: USER_ID });
    mockPrisma.campaign.delete.mockResolvedValue({});
    const req = makeReq({ method: "DELETE", query: { id: "c-1" } });
    const res = makeRes();
    await handler(req, res);
    expect(mockPrisma.campaign.delete).toHaveBeenCalledWith({ where: { id: "c-1" } });
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it("returns 405 for unsupported methods", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "PUT" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
