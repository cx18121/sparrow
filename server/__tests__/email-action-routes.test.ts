import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGetUserId, mockGenerateDraft, mockSendDraft, mockOAuth2, mockRunPersistentIdempotent, mockHashRequest } = vi.hoisted(() => {
  const mockGetUserId = vi.fn<() => Promise<string | null>>();
  const mockGenerateDraft = vi.fn();
  const mockSendDraft = vi.fn();
  const mockRunPersistentIdempotent = vi.fn(async ({ task }) => task());
  const mockHashRequest = vi.fn(() => "request-hash");
  const mockOAuth2 = vi.fn().mockImplementation(function OAuth2() {
    return {
    generateAuthUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth"),
    };
  });
  return { mockGetUserId, mockGenerateDraft, mockSendDraft, mockOAuth2, mockRunPersistentIdempotent, mockHashRequest };
});

vi.mock("../lib/supabaseAdmin.js", () => ({ getUserIdFromRequest: mockGetUserId }));
vi.mock("../lib/draft-generation.js", () => ({
  generateDraft: mockGenerateDraft,
  GenerationError: class GenerationError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
  ProfileError: class ProfileError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
}));
vi.mock("../lib/send-draft.js", () => ({ sendDraft: mockSendDraft }));
vi.mock("../lib/idempotency.js", () => ({
  hashRequest: mockHashRequest,
  sanitizeIdempotencyKey: (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null,
  runPersistentIdempotent: mockRunPersistentIdempotent,
}));
vi.mock("googleapis", () => ({ google: { auth: { OAuth2: mockOAuth2 } } }));

import generateHandler from "../routes/emails/generate.js";
import sendHandler from "../routes/emails/send.js";
import googleConnectHandler from "../routes/google/connect.js";

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    headers: { host: "localhost:5173" },
    body: null,
    query: {},
    ...overrides,
  } as unknown as VercelRequest;
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
  mockGenerateDraft.mockResolvedValue({ subject: "Hello", body: "Body" });
  mockSendDraft.mockResolvedValue({ id: "email-1", status: "sent" });
  mockRunPersistentIdempotent.mockImplementation(async ({ task }) => task());
  mockHashRequest.mockReturnValue("request-hash");
  process.env.GOOGLE_CLIENT_ID = "google-client";
  process.env.GOOGLE_CLIENT_SECRET = "google-secret";
  process.env.GOOGLE_OAUTH_STATE_SECRET = "state-secret";
});

describe("POST /emails/generate", () => {
  it("returns 400 on invalid JSON body", async () => {
    const res = makeRes();

    await generateHandler(makeReq({ body: "not-json{{{" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid JSON body" });
    expect(mockGenerateDraft).not.toHaveBeenCalled();
  });

  it("wraps generation in persistent idempotency", async () => {
    let resolveDraft: (value: { subject: string; body: string }) => void = () => {};
    mockGenerateDraft.mockReturnValue(new Promise(resolve => { resolveDraft = resolve; }));
    const req = makeReq({
      headers: { host: "localhost:5173", "idempotency-key": "generate-1" },
      body: { userLeadId: "lead-1", save: true },
    });
    const res1 = makeRes();
    const res2 = makeRes();

    const first = generateHandler(req, res1);
    const second = generateHandler(req, res2);
    resolveDraft({ subject: "Hello", body: "Body" });
    await Promise.all([first, second]);

    expect(mockRunPersistentIdempotent).toHaveBeenCalledTimes(2);
    expect(mockRunPersistentIdempotent).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      key: "draft-save:lead:lead-1:template:none:attachments:request-hash",
      requestHash: "request-hash",
    }));
    expect(res1.status).toHaveBeenCalledWith(200);
    expect(res2.status).toHaveBeenCalledWith(200);
    expect(res1.json).toHaveBeenCalledWith({ subject: "Hello", body: "Body" });
    expect(res2.json).toHaveBeenCalledWith({ subject: "Hello", body: "Body" });
  });
});

describe("POST /emails/send", () => {
  it("returns 400 on invalid JSON body", async () => {
    const res = makeRes();

    await sendHandler(makeReq({ body: "not-json{{{" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid JSON body" });
    expect(mockSendDraft).not.toHaveBeenCalled();
  });

  it("accepts a JSON string body", async () => {
    const res = makeRes();

    await sendHandler(makeReq({ body: JSON.stringify({ emailId: "email-1" }) }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSendDraft).toHaveBeenCalledWith("email-1", "user-1");
  });
});

describe("POST /google/connect", () => {
  it("returns 400 on invalid JSON body", async () => {
    const res = makeRes();

    await googleConnectHandler(makeReq({ body: "not-json{{{" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid JSON body" });
    expect(mockOAuth2).not.toHaveBeenCalled();
  });

  it("accepts a JSON string body", async () => {
    const res = makeRes();

    await googleConnectHandler(makeReq({ body: JSON.stringify({ returnTo: "/settings" }) }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ url: "https://accounts.google.com/o/oauth2/v2/auth" });
  });
});
