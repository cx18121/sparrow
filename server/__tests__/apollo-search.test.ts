import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGetUserId, mockPrisma, mockSearchContacts, mockConsumeQuota, MockQuotaError } =
  vi.hoisted(() => {
    const mockGetUserId = vi.fn<() => Promise<string | null>>();
    const mockPrisma = {
      company: { findUnique: vi.fn() },
    };
    const mockSearchContacts = vi.fn();
    const mockConsumeQuota = vi.fn();
    class MockQuotaError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "QuotaError";
      }
    }
    return { mockGetUserId, mockPrisma, mockSearchContacts, mockConsumeQuota, MockQuotaError };
  });

vi.mock("../lib/supabaseAdmin.js", () => ({ getUserIdFromRequest: mockGetUserId }));
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/apollo.js", () => ({
  searchContacts: mockSearchContacts,
  revealPerson: vi.fn(),
  normalizeDomain: (d: string) =>
    d
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, ""),
}));
vi.mock("../lib/rate-limit.js", () => ({
  consumeDurableDailyQuota: mockConsumeQuota,
  QuotaError: MockQuotaError,
}));

import handler from "../routes/apollo-search.js";

function makeReq(overrides: Record<string, unknown> = {}) {
  return { method: "GET", headers: {}, body: null, query: {}, ...overrides } as unknown as VercelRequest;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const VERIFIED_COMPANY = { id: "cmp1", domain: "rivet.dev", isVerified: true };
const APOLLO_PREVIEWS = [
  { id: "p1", first_name: "Alice", last_name_obfuscated: "S***", title: "CTO", has_email: true, organization: { name: "Rivet" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APOLLO_API_KEY = "test-key";
  mockGetUserId.mockResolvedValue("user-1");
  mockPrisma.company.findUnique.mockResolvedValue(VERIFIED_COMPANY);
  mockSearchContacts.mockResolvedValue(APOLLO_PREVIEWS);
});

describe("POST /apollo-search — apolloSearch", () => {
  it("returns 200 with previews when quota DB is unavailable (graceful degradation)", async () => {
    mockConsumeQuota.mockRejectedValue(new Error("relation 'daily_quota' does not exist"));

    const req = makeReq({
      method: "POST",
      body: { domain: "rivet.dev", companyId: "cmp1" },
    });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ previews: expect.any(Array), companyId: "cmp1" }),
    );
  });

  it("returns 429 when daily quota is exhausted", async () => {
    mockConsumeQuota.mockRejectedValue(new MockQuotaError("Daily search limit reached (100). Try again tomorrow."));

    const req = makeReq({
      method: "POST",
      body: { domain: "rivet.dev", companyId: "cmp1" },
    });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("returns 200 with previews on successful quota + search", async () => {
    mockConsumeQuota.mockResolvedValue(undefined);

    const req = makeReq({
      method: "POST",
      body: { domain: "rivet.dev", companyId: "cmp1" },
    });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.previews).toHaveLength(1);
    expect(payload.previews[0]).toMatchObject({
      id: "p1",
      firstName: "Alice",
      title: "CTO",
      hasEmail: true,
    });
  });

  it("returns 400 when companyId is missing", async () => {
    const req = makeReq({ method: "POST", body: { domain: "rivet.dev" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when company is not verified", async () => {
    mockPrisma.company.findUnique.mockResolvedValue({ ...VERIFIED_COMPANY, isVerified: false });
    const req = makeReq({ method: "POST", body: { domain: "rivet.dev", companyId: "cmp1" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 500 when APOLLO_API_KEY is not set", async () => {
    delete process.env.APOLLO_API_KEY;
    mockConsumeQuota.mockResolvedValue(undefined);
    const req = makeReq({ method: "POST", body: { domain: "rivet.dev", companyId: "cmp1" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // Bug 08: when the title-filtered search returns 0 (the common case for
  // small/non-tech startups whose teams aren't tagged with CTO/Founder/CEO
  // in Apollo), retry without the title filter so the user sees something
  // they can act on instead of "No contacts found" for nearly every company.
  it("falls back to a no-title search when titled search returns 0", async () => {
    mockConsumeQuota.mockResolvedValue(undefined);
    const FALLBACK_PREVIEW = {
      id: "p2", first_name: "Bob", last_name_obfuscated: "K***",
      title: "Product Manager", has_email: true, organization: { name: "Rivet" },
    };
    mockSearchContacts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([FALLBACK_PREVIEW]);

    const req = makeReq({ method: "POST", body: { domain: "rivet.dev", companyId: "cmp1" } });
    const res = makeRes();
    await handler(req, res);

    expect(mockSearchContacts).toHaveBeenCalledTimes(2);
    expect(mockSearchContacts).toHaveBeenNthCalledWith(1, "rivet.dev", "test-key", expect.objectContaining({ retry: false }));
    expect(mockSearchContacts).toHaveBeenNthCalledWith(2, "rivet.dev", "test-key", expect.objectContaining({ retry: false, titleFilter: false }));
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.previews).toHaveLength(1);
    expect(payload.usedFallback).toBe(true);
  });

  it("does not call the fallback search when titled search returns results", async () => {
    mockConsumeQuota.mockResolvedValue(undefined);
    const req = makeReq({ method: "POST", body: { domain: "rivet.dev", companyId: "cmp1" } });
    const res = makeRes();
    await handler(req, res);
    expect(mockSearchContacts).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.usedFallback).toBe(false);
  });

  it("returns 200 with usedFallback=true and empty previews when both passes return 0", async () => {
    mockConsumeQuota.mockResolvedValue(undefined);
    mockSearchContacts.mockReset();
    mockSearchContacts.mockResolvedValue([]);

    const req = makeReq({ method: "POST", body: { domain: "rivet.dev", companyId: "cmp1" } });
    const res = makeRes();
    await handler(req, res);

    expect(mockSearchContacts).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.previews).toHaveLength(0);
    expect(payload.usedFallback).toBe(true);
  });
});
