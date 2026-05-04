import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Mock all route modules to avoid their transitive dependencies (Prisma, Supabase, etc.)
vi.mock("../routes/apollo-search.js", () => ({ default: vi.fn() }));
vi.mock("../routes/account.js", () => ({ default: vi.fn() }));
vi.mock("../routes/audience-query.js", () => ({ default: vi.fn() }));
vi.mock("../routes/campaign-leads.js", () => ({ default: vi.fn() }));
vi.mock("../routes/campaign-options.js", () => ({ default: vi.fn() }));
vi.mock("../routes/campaigns.js", () => ({ default: vi.fn() }));
vi.mock("../routes/companies.js", () => ({ default: vi.fn() }));
vi.mock("../routes/custom-contacts.js", () => ({ default: vi.fn() }));
vi.mock("../routes/emails.js", () => ({ default: vi.fn() }));
vi.mock("../routes/emails/generate.js", () => ({ default: vi.fn() }));
vi.mock("../routes/emails/send.js", () => ({ default: vi.fn() }));
vi.mock("../routes/emails/send-test.js", () => ({ default: vi.fn() }));
vi.mock("../routes/style-guide.js", () => ({ default: vi.fn() }));
vi.mock("../routes/google/callback.js", () => ({ default: vi.fn() }));
vi.mock("../routes/google/connect.js", () => ({ default: vi.fn() }));
vi.mock("../routes/health.js", () => ({ default: vi.fn() }));
vi.mock("../routes/leads.js", () => ({ default: vi.fn() }));
vi.mock("../routes/profile.js", () => ({ default: vi.fn() }));
vi.mock("../routes/templates.js", () => ({ default: vi.fn() }));

import { dispatchApiRequest, routeHandlers } from "../router.js";

function makeReq(overrides: Record<string, unknown> = {}) {
  return { method: "GET", headers: {}, body: null, query: {}, ...overrides } as unknown as VercelRequest;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.headersSent = false;
  return res;
}

describe("dispatchApiRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("known route dispatches to handler", async () => {
    const healthHandler = routeHandlers["/api/health"] as ReturnType<typeof vi.fn>;
    healthHandler.mockResolvedValue(undefined);

    const req = makeReq({ url: "http://localhost/api/health" });
    const res = makeRes();
    await dispatchApiRequest(req, res);
    expect(healthHandler).toHaveBeenCalledOnce();
  });

  it("unknown route returns 404 with error JSON", async () => {
    const req = makeReq({ url: "http://localhost/api/nonexistent-route-xyz" });
    const res = makeRes();
    await dispatchApiRequest(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Not found" });
  });

  it("handler that throws returns sanitized 500 JSON", async () => {
    const healthHandler = routeHandlers["/api/health"] as ReturnType<typeof vi.fn>;
    healthHandler.mockRejectedValue(new Error("Something exploded"));

    const req = makeReq({ url: "http://localhost/api/health" });
    const res = makeRes();
    await dispatchApiRequest(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  it("strips `path` from req.query before dispatch", async () => {
    const healthHandler = routeHandlers["/api/health"] as ReturnType<typeof vi.fn>;
    let capturedReq: VercelRequest | null = null;
    healthHandler.mockImplementation(async (req: VercelRequest) => {
      capturedReq = req;
    });

    const req = makeReq({ query: { path: "health", other: "value" } });
    const res = makeRes();
    await dispatchApiRequest(req, res);
    expect(capturedReq!.query).not.toHaveProperty("path");
    expect((capturedReq!.query as Record<string, unknown>).other).toBe("value");
  });

  it("resolves path from req.query.path when URL is absent", async () => {
    const profileHandler = routeHandlers["/api/profile"] as ReturnType<typeof vi.fn>;
    profileHandler.mockResolvedValue(undefined);

    const req = makeReq({ url: undefined, query: { path: "profile" } });
    const res = makeRes();
    await dispatchApiRequest(req, res);
    expect(profileHandler).toHaveBeenCalledOnce();
  });
});
