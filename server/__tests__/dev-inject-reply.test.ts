import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { mockPrisma, mockGetUserId, mockInvalidate } = vi.hoisted(() => ({
  mockPrisma: {
    email: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userLead: { update: vi.fn() },
    customContact: { update: vi.fn() },
  },
  mockGetUserId: vi.fn(),
  mockInvalidate: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/supabaseAdmin.js", () => ({ getUserIdFromRequest: mockGetUserId }));
vi.mock("../lib/email-cache.js", () => ({ invalidateEmailDashboardCache: mockInvalidate }));

import handler from "../routes/dev/inject-reply.js";

function makeReq(body: Record<string, unknown> = {}, method = "POST"): VercelRequest {
  return { method, headers: {}, body, query: {} } as unknown as VercelRequest;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res as VercelResponse & { status: any; json: any };
}

const ORIGINAL_ENV = process.env.NODE_ENV;
const OWNED_EMAIL = {
  id: "email-1",
  userLeadId: "lead-1",
  customContactId: null,
  userLead: { userId: "user-1" },
  customContact: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: dev environment, authenticated as the email's owner, email exists.
  process.env.NODE_ENV = "development";
  mockGetUserId.mockResolvedValue("user-1");
  mockPrisma.email.findUnique.mockResolvedValue(OWNED_EMAIL);
  mockPrisma.email.update.mockResolvedValue({ id: "email-1", repliedAt: new Date() });
  mockPrisma.userLead.update.mockResolvedValue({});
  mockPrisma.customContact.update.mockResolvedValue({});
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
});

describe("POST /api/dev/inject-reply", () => {
  it("returns 404 in production so the route looks non-existent", async () => {
    process.env.NODE_ENV = "production";
    const res = makeRes();
    await handler(makeReq({ emailId: "email-1" }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockPrisma.email.findUnique).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods", async () => {
    const res = makeRes();
    await handler(makeReq({}, "GET"), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("requires authentication", async () => {
    mockGetUserId.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq({ emailId: "email-1" }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("requires emailId in body", async () => {
    const res = makeRes();
    await handler(makeReq({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the email row does not exist", async () => {
    mockPrisma.email.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq({ emailId: "nope" }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 404 when caller does not own the email row", async () => {
    mockGetUserId.mockResolvedValue("other-user");
    const res = makeRes();
    await handler(makeReq({ emailId: "email-1" }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockPrisma.email.update).not.toHaveBeenCalled();
  });

  it("classifies a plain reply and flips the lead status to RESPONDED", async () => {
    const res = makeRes();
    await handler(makeReq({
      emailId: "email-1",
      fromAddress: "alice@example.com",
      subject: "Re: hi",
      snippet: "Sounds good, let's talk.",
    }), res);

    expect(mockPrisma.email.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.email.update.mock.calls[0][0];
    expect(updateArgs.data.replyClassification).toBe("REPLY");
    expect(updateArgs.data.replyFrom).toBe("alice@example.com");
    expect(updateArgs.data.repliedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.replyMessageId).toMatch(/^dev-injected-/);

    expect(mockPrisma.userLead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { status: "RESPONDED" },
    });
    expect(mockInvalidate).toHaveBeenCalledWith("user-1");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("classifies an OOO auto-reply and does NOT flip lead status", async () => {
    const res = makeRes();
    await handler(makeReq({
      emailId: "email-1",
      subject: "Out of office: away until next week",
      snippet: "I am currently out of the office.",
    }), res);

    const updateArgs = mockPrisma.email.update.mock.calls[0][0];
    expect(updateArgs.data.replyClassification).toBe("AUTO_REPLY");
    expect(mockPrisma.userLead.update).not.toHaveBeenCalled();
  });

  it("classifies a bounce and does NOT flip lead status", async () => {
    const res = makeRes();
    await handler(makeReq({
      emailId: "email-1",
      fromAddress: "mailer-daemon@example.com",
      subject: "Undeliverable: outreach",
      snippet: "Your message could not be delivered.",
    }), res);

    const updateArgs = mockPrisma.email.update.mock.calls[0][0];
    expect(updateArgs.data.replyClassification).toBe("BOUNCE");
    expect(mockPrisma.userLead.update).not.toHaveBeenCalled();
  });

  it("flips status on a customContact email row when there's no UserLead", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email-2",
      userLeadId: null,
      customContactId: "cc-1",
      userLead: null,
      customContact: { userId: "user-1" },
    });
    const res = makeRes();
    await handler(makeReq({ emailId: "email-2" }), res);
    expect(mockPrisma.customContact.update).toHaveBeenCalledWith({
      where: { id: "cc-1" },
      data: { status: "RESPONDED" },
    });
    expect(mockPrisma.userLead.update).not.toHaveBeenCalled();
  });

  it("honours caller-supplied headers (Auto-Submitted forces AUTO_REPLY)", async () => {
    const res = makeRes();
    await handler(makeReq({
      emailId: "email-1",
      subject: "Re: hi",
      snippet: "Looks great",
      headers: { "Auto-Submitted": "auto-replied" },
    }), res);
    const updateArgs = mockPrisma.email.update.mock.calls[0][0];
    expect(updateArgs.data.replyClassification).toBe("AUTO_REPLY");
  });
});
