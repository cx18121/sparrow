import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// --- Hoisted mocks ---

const { mockPrisma, mockVerifyIdToken, mockHistoryList, mockMessageGet, mockSupabase } = vi.hoisted(() => {
  const mockPrisma = {
    userGmailWatch: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    email: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    userLead: { update: vi.fn() },
    customContact: { update: vi.fn() },
  };
  const mockVerifyIdToken = vi.fn();
  const mockHistoryList = vi.fn();
  const mockMessageGet = vi.fn();
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  return { mockPrisma, mockVerifyIdToken, mockHistoryList, mockMessageGet, mockSupabase };
});

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => mockSupabase }));
vi.mock("../lib/crypto.js", () => ({ decrypt: (v: string) => v }));
vi.mock("google-auth-library", () => ({
  OAuth2Client: function OAuth2Client() { return { verifyIdToken: mockVerifyIdToken }; },
}));
vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: function OAuth2() { return { setCredentials: vi.fn() }; } },
    gmail: vi.fn().mockReturnValue({
      users: {
        history: { list: mockHistoryList },
        messages: { get: mockMessageGet },
      },
    }),
  },
}));

import handler from "../routes/webhooks/gmail.js";

// --- Helpers ---

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return { method: "POST", headers: {}, body: null, query: {}, ...overrides } as unknown as VercelRequest;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}

function makePubSubBody(emailAddress: string, historyId: string) {
  const data = Buffer.from(JSON.stringify({ emailAddress, historyId })).toString("base64");
  return { message: { data } };
}

function makeMessage(overrides: {
  id?: string;
  threadId?: string;
  fromAddress?: string;
  subject?: string;
  snippet?: string;
  autoSubmitted?: string;
}) {
  return {
    data: {
      id: overrides.id ?? "msg1",
      threadId: overrides.threadId ?? "thread1",
      snippet: overrides.snippet ?? "Thanks for reaching out!",
      payload: {
        headers: [
          { name: "From", value: overrides.fromAddress ?? "alice@example.com" },
          { name: "Subject", value: overrides.subject ?? "Re: Quick intro" },
          ...(overrides.autoSubmitted ? [{ name: "Auto-Submitted", value: overrides.autoSubmitted }] : []),
        ],
      },
    },
  };
}

const VALID_WATCH = {
  userId: "user-1",
  email: "sender@example.com",
  historyId: "100",
  pubsubTopic: "projects/p/topics/t",
  watchExpiresAt: new Date(Date.now() + 86400000),
};

const VALID_SENT_EMAIL = {
  id: "email-1",
  userLeadId: "lead-1",
  customContactId: null,
  replyMessageId: null,
  userLead: { userId: "user-1" },
  customContact: null,
};

process.env.GMAIL_WEBHOOK_AUDIENCE = "https://api.example.com/api/webhooks/gmail";

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({});
  mockSupabase.maybeSingle.mockResolvedValue({ data: { google_refresh_token_encrypted: "token" } });
  mockPrisma.userGmailWatch.findUnique.mockResolvedValue(VALID_WATCH);
  mockPrisma.userGmailWatch.update.mockResolvedValue({});
  mockPrisma.email.findFirst.mockResolvedValue(VALID_SENT_EMAIL);
  mockPrisma.email.update.mockResolvedValue({});
  mockPrisma.userLead.update.mockResolvedValue({});
  mockHistoryList.mockResolvedValue({
    data: { history: [{ messagesAdded: [{ message: { id: "msg1" } }] }] },
  });
  mockMessageGet.mockResolvedValue(makeMessage({}));
});

describe("POST /api/webhooks/gmail", () => {
  it("rejects non-POST requests", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "GET" }), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("returns 401 when OIDC verification fails", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("bad token"));
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: "Bearer bad" }, body: makePubSubBody("a@b.com", "123") }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("ACKs (200) when no watch exists for the email", async () => {
    mockPrisma.userGmailWatch.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("unknown@example.com", "123") }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockHistoryList).not.toHaveBeenCalled();
  });

  it("ACKs (200) on unrecognized Pub/Sub message shape", async () => {
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: "Bearer tok" }, body: { weird: true } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("classifies a human reply and updates the email row", async () => {
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(mockPrisma.email.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "email-1" },
        data: expect.objectContaining({ replyClassification: "REPLY", replyMessageId: "msg1" }),
      }),
    );
    expect(mockPrisma.userLead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RESPONDED" } }),
    );
  });

  it("classifies an OOO auto-reply and does NOT update lead status", async () => {
    mockMessageGet.mockResolvedValue(makeMessage({
      subject: "Out of Office: Quick intro",
      autoSubmitted: "auto-replied",
    }));
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(mockPrisma.email.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ replyClassification: "AUTO_REPLY" }),
      }),
    );
    expect(mockPrisma.userLead.update).not.toHaveBeenCalled();
  });

  it("classifies a bounce and marks the lead BOUNCED so it isn't re-emailed", async () => {
    mockMessageGet.mockResolvedValue(makeMessage({
      fromAddress: "mailer-daemon@googlemail.com",
      subject: "Delivery Status Notification (Failure)",
    }));
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(mockPrisma.email.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ replyClassification: "BOUNCE" }),
      }),
    );
    // The whole point: a bounce must transition the lead away from EMAILED
    // to BOUNCED — RESPONDED would falsely read as a real reply.
    expect(mockPrisma.userLead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "BOUNCED" } }),
    );
  });

  it("skips messages sent by the user themselves", async () => {
    mockMessageGet.mockResolvedValue(makeMessage({ fromAddress: "sender@example.com" }));
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(mockPrisma.email.update).not.toHaveBeenCalled();
  });

  it("skips if replyMessageId already matches (idempotency)", async () => {
    mockPrisma.email.findFirst.mockResolvedValue({ ...VALID_SENT_EMAIL, replyMessageId: "msg1" });
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(mockPrisma.email.update).not.toHaveBeenCalled();
  });

  it("advances the historyId cursor after clean processing", async () => {
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(mockPrisma.userGmailWatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { historyId: "200" } }),
    );
  });

  it("does NOT advance historyId when a message fails to process", async () => {
    mockMessageGet.mockRejectedValue(new Error("Gmail API error"));
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(mockPrisma.userGmailWatch.update).not.toHaveBeenCalled();
  });

  it("paginates through multiple history pages", async () => {
    mockHistoryList
      .mockResolvedValueOnce({
        data: {
          history: [{ messagesAdded: [{ message: { id: "msg1" } }] }],
          nextPageToken: "page2",
        },
      })
      .mockResolvedValueOnce({
        data: {
          history: [{ messagesAdded: [{ message: { id: "msg2" } }] }],
        },
      });
    mockPrisma.email.findFirst
      .mockResolvedValueOnce(VALID_SENT_EMAIL)
      .mockResolvedValueOnce({ ...VALID_SENT_EMAIL, id: "email-2" });

    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(mockHistoryList).toHaveBeenCalledTimes(2);
    expect(mockPrisma.email.update).toHaveBeenCalledTimes(2);
  });

  it("updates customContact status when email is linked to a custom contact", async () => {
    mockPrisma.email.findFirst.mockResolvedValue({
      id: "email-1",
      userLeadId: null,
      customContactId: "cc-1",
      replyMessageId: null,
      userLead: null,
      customContact: { userId: "user-1" },
    });
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(mockPrisma.customContact.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cc-1" }, data: { status: "RESPONDED" } }),
    );
    expect(mockPrisma.userLead.update).not.toHaveBeenCalled();
  });

  // Replay / out-of-order protection: a stale notification must not drag the
  // cursor backward, which would force a re-walk of already-processed history.
  it("does NOT advance the cursor when the incoming historyId is older than stored", async () => {
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "50") }),
      res,
    );
    // VALID_WATCH.historyId is "100"; "50" is older → no advance.
    expect(mockPrisma.userGmailWatch.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("does NOT advance the cursor when the incoming historyId equals stored", async () => {
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "100") }),
      res,
    );
    expect(mockPrisma.userGmailWatch.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/gmail — service-account pinning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.maybeSingle.mockResolvedValue({ data: { google_refresh_token_encrypted: "token" } });
    mockPrisma.userGmailWatch.findUnique.mockResolvedValue(VALID_WATCH);
    mockPrisma.userGmailWatch.update.mockResolvedValue({});
    mockPrisma.email.findFirst.mockResolvedValue(VALID_SENT_EMAIL);
    mockPrisma.email.update.mockResolvedValue({});
    mockPrisma.userLead.update.mockResolvedValue({});
    mockHistoryList.mockResolvedValue({
      data: { history: [{ messagesAdded: [{ message: { id: "msg1" } }] }] },
    });
    mockMessageGet.mockResolvedValue(makeMessage({}));
  });

  afterEach(() => {
    delete process.env.GMAIL_WEBHOOK_SA_EMAIL;
  });

  it("accepts a token whose verified email matches GMAIL_WEBHOOK_SA_EMAIL", async () => {
    process.env.GMAIL_WEBHOOK_SA_EMAIL = "pubsub@my-proj.iam.gserviceaccount.com";
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: "pubsub@my-proj.iam.gserviceaccount.com", email_verified: true }),
    });
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockPrisma.email.update).toHaveBeenCalled();
  });

  it("rejects (401) a Google-signed token from a different service account", async () => {
    process.env.GMAIL_WEBHOOK_SA_EMAIL = "pubsub@my-proj.iam.gserviceaccount.com";
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: "attacker@evil-proj.iam.gserviceaccount.com", email_verified: true }),
    });
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockHistoryList).not.toHaveBeenCalled();
  });

  it("rejects (401) when the matching email is not verified", async () => {
    process.env.GMAIL_WEBHOOK_SA_EMAIL = "pubsub@my-proj.iam.gserviceaccount.com";
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: "pubsub@my-proj.iam.gserviceaccount.com", email_verified: false }),
    });
    const res = makeRes();
    await handler(
      makeReq({ headers: { authorization: "Bearer tok" }, body: makePubSubBody("sender@example.com", "200") }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
