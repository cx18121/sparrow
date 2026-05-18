import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGetUserId, mockPrisma } = vi.hoisted(() => {
  const mockGetUserId = vi.fn<() => Promise<string | null>>();
  const mockPrisma = {
    template: {
      findMany: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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

import handler from "../routes/templates.js";

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

const USER_ID = "user-templates-test";

describe("templates route — GET", () => {
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

  it("returns sanitized 500 JSON when auth lookup fails", async () => {
    mockGetUserId.mockRejectedValue(new Error("Supabase unavailable"));
    const req = makeReq({ method: "GET" });
    const res = makeRes();

    await expect(handler(req, res)).resolves.not.toThrow();

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "An unexpected error occurred" });
  });

  it("returns the user's templates plus shared library templates", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const templates = [
      { id: "t-1", userId: USER_ID, name: "My Template", isShared: false },
      { id: "lib_warm_intro", userId: "__library__", name: "Warm Intro", isShared: true },
    ];
    mockPrisma.template.findMany.mockResolvedValue(templates);
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockPrisma.template.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ userId: USER_ID }, { userId: "__library__" }] },
    }));
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.items).toHaveLength(2);
  });
});

describe("templates route — POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 on invalid JSON body", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "POST", body: "{not json" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid JSON body" });
  });

  it("returns 401 without userId", async () => {
    mockGetUserId.mockResolvedValue(null);
    const req = makeReq({ method: "POST", body: { name: "T", subject: "S", body: "B" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when required fields are missing", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "POST", body: { name: "T" } }); // missing subject and body
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "name, subject, and body are required" });
  });

  it("creates template and returns 201", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const newTemplate = { id: "t-new", userId: USER_ID, name: "My T", subject: "Sub", body: "Body text", isShared: false };
    mockPrisma.template.create.mockResolvedValue(newTemplate);
    const req = makeReq({ method: "POST", body: { name: "My T", subject: "Sub", body: "Body text" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(newTemplate);
  });

  it("creates template with sanitized attachmentIds", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.template.create.mockResolvedValue({ id: "t-files" });

    const req = makeReq({
      method: "POST",
      body: {
        name: "My T",
        subject: "Sub",
        body: "Body text",
        attachmentIds: ["resume", 42, "file-1", ""],
      },
    });
    await handler(req, makeRes());

    expect(mockPrisma.template.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attachmentIds: ["resume", "file-1"] }),
    }));
  });

  it("defaults verbatim to true; honors explicit false", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.template.create.mockResolvedValue({ id: "t-v" });

    const reqDefault = makeReq({ method: "POST", body: { name: "V", subject: "S", body: "B" } });
    await handler(reqDefault, makeRes());
    expect(mockPrisma.template.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ verbatim: true }),
    }));

    const reqExplicitFalse = makeReq({ method: "POST", body: { name: "V", subject: "S", body: "B", verbatim: false } });
    await handler(reqExplicitFalse, makeRes());
    expect(mockPrisma.template.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ verbatim: false }),
    }));
  });
});

describe("templates route — PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when id is missing", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    const req = makeReq({ method: "PATCH", body: { name: "New Name" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "id is required" });
  });

  it("returns 404 when template not found", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.template.findUnique.mockResolvedValue(null);
    const req = makeReq({ method: "PATCH", body: { id: "no-template", name: "New Name" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Template not found" });
  });

  it("returns 404 when template belongs to different user", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.template.findUnique.mockResolvedValue({ id: "t-1", userId: "other-user" });
    const req = makeReq({ method: "PATCH", body: { id: "t-1", name: "New Name" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("updates template and returns 200", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.template.findUnique.mockResolvedValue({ id: "t-1", userId: USER_ID });
    const updated = { id: "t-1", userId: USER_ID, name: "Updated", subject: "Sub", body: "Body" };
    mockPrisma.template.update.mockResolvedValue(updated);
    const req = makeReq({ method: "PATCH", body: { id: "t-1", name: "Updated" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(updated);
  });

  it("updates template attachmentIds", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.template.findUnique.mockResolvedValue({ id: "t-1", userId: USER_ID });
    mockPrisma.template.update.mockResolvedValue({ id: "t-1", attachmentIds: ["resume"] });

    const req = makeReq({ method: "PATCH", body: { id: "t-1", attachmentIds: ["resume", null, "file-2"] } });
    await handler(req, makeRes());

    expect(mockPrisma.template.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attachmentIds: ["resume", "file-2"] }),
    }));
  });
});

describe("templates route — DELETE", () => {
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

  it("returns 404 when template not found", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.template.findUnique.mockResolvedValue(null);
    const req = makeReq({ method: "DELETE", query: { id: "no-t" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("deletes template and returns 204", async () => {
    mockGetUserId.mockResolvedValue(USER_ID);
    mockPrisma.template.findUnique.mockResolvedValue({ id: "t-1", userId: USER_ID });
    mockPrisma.template.delete.mockResolvedValue({});
    const req = makeReq({ method: "DELETE", query: { id: "t-1" } });
    const res = makeRes();
    await handler(req, res);
    expect(mockPrisma.template.delete).toHaveBeenCalledWith({ where: { id: "t-1" } });
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
