import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Integration-style tests for /api/webhooks/gmail.
//
// The sibling gmail-webhook.test.ts pins individual behaviors of the
// handler with surgical assertions on single mock calls. This file
// complements those with end-to-end *composed-state* checks: given a
// Pub/Sub envelope that triggers a multi-message, multi-page batch,
// what is the final shape of every Prisma write that happened, and
// did the historyId cursor land where it should?
//
// The point is to catch refactors that keep individual units green but
// scramble the orchestration — wrong cursor advance under partial
// failure, lead-status updates fired against the wrong row, replies
// from one user's thread bleeding into another's. The unit tests
// would happily pass through all of those.
//
// We still mock at the network boundary (googleapis + OIDC + Supabase
// + Prisma). A true integration test would point Prisma at a real
// test DB — out of scope here because the rest of the suite doesn't
// have that infrastructure (e2e specs use Docker + Supabase via
// playwright per CLAUDE.md). What matters here is composed behavior.

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

// ----- helpers -----

function makeReq(historyId: string): VercelRequest {
  const data = Buffer.from(JSON.stringify({ emailAddress: "sender@example.com", historyId })).toString("base64");
  return {
    method: "POST",
    headers: { authorization: "Bearer tok" },
    body: { message: { data } },
    query: {},
  } as unknown as VercelRequest;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res as VercelResponse & { status: any; end: any };
}

interface MessageShape {
  id: string;
  threadId?: string;
  fromAddress?: string;
  subject?: string;
  snippet?: string;
  autoSubmitted?: string;
  xAutoreply?: string;
}

function makeMessage(m: MessageShape) {
  const headers: Array<{ name: string; value: string }> = [
    { name: "From", value: m.fromAddress ?? "alice@example.com" },
    { name: "Subject", value: m.subject ?? "Re: outreach" },
  ];
  if (m.autoSubmitted) headers.push({ name: "Auto-Submitted", value: m.autoSubmitted });
  if (m.xAutoreply) headers.push({ name: "X-Autoreply", value: m.xAutoreply });
  return {
    data: {
      id: m.id,
      threadId: m.threadId ?? `thread-${m.id}`,
      snippet: m.snippet ?? "Sounds good, let's chat.",
      payload: { headers },
    },
  };
}

function makeSentEmail(overrides: Partial<{
  id: string;
  threadId: string;
  userLeadId: string | null;
  customContactId: string | null;
  replyMessageId: string | null;
  ownerUserId: string;
}> = {}) {
  return {
    id: overrides.id ?? "email-1",
    userLeadId: overrides.userLeadId === undefined ? "lead-1" : overrides.userLeadId,
    customContactId: overrides.customContactId === undefined ? null : overrides.customContactId,
    replyMessageId: overrides.replyMessageId ?? null,
    userLead: overrides.userLeadId === null ? null : { userId: overrides.ownerUserId ?? "user-1" },
    customContact: overrides.customContactId
      ? { userId: overrides.ownerUserId ?? "user-1" }
      : null,
  };
}

const VALID_WATCH = {
  userId: "user-1",
  email: "sender@example.com",
  historyId: "100",
  pubsubTopic: "projects/p/topics/t",
  watchExpiresAt: new Date(Date.now() + 86400000),
};

process.env.GMAIL_WEBHOOK_AUDIENCE = "https://api.example.com/api/webhooks/gmail";

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({});
  mockSupabase.maybeSingle.mockResolvedValue({ data: { google_refresh_token_encrypted: "token" } });
  mockPrisma.userGmailWatch.findUnique.mockResolvedValue(VALID_WATCH);
  mockPrisma.userGmailWatch.update.mockResolvedValue({});
  mockPrisma.email.update.mockResolvedValue({});
  mockPrisma.userLead.update.mockResolvedValue({});
  mockPrisma.customContact.update.mockResolvedValue({});
});

// Collect the (where.id → data.replyClassification) shape from every
// email.update call so tests can assert on the composed final state
// instead of inspecting individual mock invocations.
function emailUpdateMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const call of mockPrisma.email.update.mock.calls) {
    const id = call[0]?.where?.id;
    const cls = call[0]?.data?.replyClassification;
    if (id) out[id] = cls;
  }
  return out;
}

function leadUpdateIds(): string[] {
  return mockPrisma.userLead.update.mock.calls.map(c => c[0]?.where?.id).filter(Boolean);
}

function customContactUpdateIds(): string[] {
  return mockPrisma.customContact.update.mock.calls.map(c => c[0]?.where?.id).filter(Boolean);
}

describe("Integration: /api/webhooks/gmail composed state", () => {
  it("processes a mixed batch (REPLY + AUTO_REPLY + self-sent) and only flips lead status for the human reply", async () => {
    mockHistoryList.mockResolvedValue({
      data: {
        history: [{
          messagesAdded: [
            { message: { id: "msg-reply" } },
            { message: { id: "msg-ooo" } },
            { message: { id: "msg-self" } },
          ],
        }],
      },
    });

    // Each Gmail message.get returns a different shape; classifyReply
    // should disambiguate.
    mockMessageGet.mockImplementation(({ id }: { id: string }) => {
      if (id === "msg-reply") return Promise.resolve(makeMessage({
        id: "msg-reply", threadId: "t-reply",
        fromAddress: "alice@external.com",
        subject: "Re: hi",
        snippet: "Happy to chat — Wednesday works.",
      }));
      if (id === "msg-ooo") return Promise.resolve(makeMessage({
        id: "msg-ooo", threadId: "t-ooo",
        fromAddress: "bob@external.com",
        subject: "Out of office — back Monday",
        snippet: "I am currently away from the office.",
      }));
      // msg-self: simulates the user replying inside their own thread.
      return Promise.resolve(makeMessage({
        id: "msg-self", threadId: "t-self",
        fromAddress: "sender@example.com",
        subject: "Re: hi again",
        snippet: "Quick follow-up.",
      }));
    });

    mockPrisma.email.findFirst.mockImplementation(({ where }: { where: { gmailThreadId: string } }) => {
      if (where.gmailThreadId === "t-reply") return Promise.resolve(makeSentEmail({ id: "email-reply", userLeadId: "lead-reply" }));
      if (where.gmailThreadId === "t-ooo") return Promise.resolve(makeSentEmail({ id: "email-ooo", userLeadId: "lead-ooo" }));
      if (where.gmailThreadId === "t-self") return Promise.resolve(makeSentEmail({ id: "email-self", userLeadId: "lead-self" }));
      return Promise.resolve(null);
    });

    const res = makeRes();
    await handler(makeReq("200"), res);

    const updates = emailUpdateMap();
    expect(updates).toEqual({
      "email-reply": "REPLY",
      "email-ooo": "AUTO_REPLY",
      // email-self is NOT in the map: self-sent skip happens BEFORE the
      // email.update call, so there's no row write for that thread.
    });
    expect(leadUpdateIds()).toEqual(["lead-reply"]);
    // Cursor advances because no message threw.
    expect(mockPrisma.userGmailWatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { historyId: "200" } }),
    );
  });

  it("partial-failure (1 of 3 messages throws on Gmail fetch): processes the rest but withholds cursor advance", async () => {
    mockHistoryList.mockResolvedValue({
      data: {
        history: [{
          messagesAdded: [
            { message: { id: "msg-a" } },
            { message: { id: "msg-b" } },
            { message: { id: "msg-c" } },
          ],
        }],
      },
    });
    mockMessageGet.mockImplementation(({ id }: { id: string }) => {
      if (id === "msg-b") return Promise.reject(new Error("Gmail 5xx"));
      return Promise.resolve(makeMessage({ id, threadId: `t-${id}` }));
    });
    mockPrisma.email.findFirst.mockImplementation(({ where }: { where: { gmailThreadId: string } }) =>
      Promise.resolve(makeSentEmail({ id: `email-${where.gmailThreadId}`, userLeadId: `lead-${where.gmailThreadId}` })),
    );

    const res = makeRes();
    await handler(makeReq("200"), res);

    // msg-a and msg-c land as REPLY; msg-b never reaches the update path.
    const updates = emailUpdateMap();
    expect(Object.keys(updates).sort()).toEqual(["email-t-msg-a", "email-t-msg-c"]);
    expect(updates["email-t-msg-a"]).toBe("REPLY");
    expect(updates["email-t-msg-c"]).toBe("REPLY");

    // Critical: cursor MUST NOT advance — Pub/Sub needs to redeliver so
    // we get another shot at msg-b on the next event.
    expect(mockPrisma.userGmailWatch.update).not.toHaveBeenCalled();
  });

  it("across multiple history pages, same messageId arriving twice doesn't double-update the row", async () => {
    // Page 1 returns msg-x; page 2 returns msg-x again (Gmail does this
    // occasionally when overlapping watches fire). The handler dedupes
    // via Set<string> before fetching, so messages.get is called once.
    mockHistoryList
      .mockResolvedValueOnce({
        data: {
          history: [{ messagesAdded: [{ message: { id: "msg-x" } }] }],
          nextPageToken: "page2",
        },
      })
      .mockResolvedValueOnce({
        data: { history: [{ messagesAdded: [{ message: { id: "msg-x" } }] }] },
      });
    mockMessageGet.mockResolvedValue(makeMessage({ id: "msg-x", threadId: "t-x" }));
    mockPrisma.email.findFirst.mockResolvedValue(makeSentEmail({ id: "email-x", userLeadId: "lead-x" }));

    const res = makeRes();
    await handler(makeReq("200"), res);

    expect(mockMessageGet).toHaveBeenCalledTimes(1);
    expect(mockPrisma.email.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.userLead.update).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-user reply: thread matches a sent email owned by a different user → no writes", async () => {
    // The watch is for user-1, but the thread's sent email is owned by
    // user-2. This shouldn't be possible in practice (watches are per
    // gmail account) but the handler enforces it as defense in depth.
    mockHistoryList.mockResolvedValue({
      data: { history: [{ messagesAdded: [{ message: { id: "msg-x" } }] }] },
    });
    mockMessageGet.mockResolvedValue(makeMessage({ id: "msg-x", threadId: "t-x" }));
    mockPrisma.email.findFirst.mockResolvedValue(makeSentEmail({
      id: "email-x",
      userLeadId: "lead-x",
      ownerUserId: "user-2", // foreign owner
    }));

    const res = makeRes();
    await handler(makeReq("200"), res);

    expect(mockPrisma.email.update).not.toHaveBeenCalled();
    expect(mockPrisma.userLead.update).not.toHaveBeenCalled();
    // Cursor still advances — there was no error, just nothing applicable.
    expect(mockPrisma.userGmailWatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { historyId: "200" } }),
    );
  });

  it("AUTO_REPLY classification fires on X-Autoreply header alone (no OOO-pattern subject)", async () => {
    // Real-world auto-responders sometimes use a plain "Re:" subject and
    // signal automation only via the header. The header-driven branch
    // exists in classifyReply but is easy to break in a refactor that
    // assumes the regexes are the only path.
    mockHistoryList.mockResolvedValue({
      data: { history: [{ messagesAdded: [{ message: { id: "msg-x" } }] }] },
    });
    mockMessageGet.mockResolvedValue(makeMessage({
      id: "msg-x", threadId: "t-x",
      subject: "Re: outreach",
      snippet: "Thanks — will review.",
      xAutoreply: "yes",
    }));
    mockPrisma.email.findFirst.mockResolvedValue(makeSentEmail({ id: "email-x", userLeadId: "lead-x" }));

    const res = makeRes();
    await handler(makeReq("200"), res);
    expect(emailUpdateMap()["email-x"]).toBe("AUTO_REPLY");
    expect(leadUpdateIds()).toEqual([]);
  });

  it("empty history (no new messages, watch fires on label change): cursor still advances", async () => {
    mockHistoryList.mockResolvedValue({ data: { history: [] } });

    const res = makeRes();
    await handler(makeReq("200"), res);

    expect(mockMessageGet).not.toHaveBeenCalled();
    expect(mockPrisma.email.update).not.toHaveBeenCalled();
    // Cursor advances — empty batches are valid forward motion.
    expect(mockPrisma.userGmailWatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { historyId: "200" } }),
    );
  });

  it("customContact + UserLead replies coexist in one batch and update the correct status table for each", async () => {
    mockHistoryList.mockResolvedValue({
      data: { history: [{ messagesAdded: [
        { message: { id: "msg-lead" } },
        { message: { id: "msg-cc" } },
      ] }] },
    });
    mockMessageGet.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(makeMessage({ id, threadId: `t-${id}` })),
    );
    mockPrisma.email.findFirst.mockImplementation(({ where }: { where: { gmailThreadId: string } }) => {
      if (where.gmailThreadId === "t-msg-lead") {
        return Promise.resolve(makeSentEmail({ id: "email-lead", userLeadId: "lead-1" }));
      }
      return Promise.resolve(makeSentEmail({
        id: "email-cc",
        userLeadId: null,
        customContactId: "cc-1",
      }));
    });

    const res = makeRes();
    await handler(makeReq("200"), res);

    expect(leadUpdateIds()).toEqual(["lead-1"]);
    expect(customContactUpdateIds()).toEqual(["cc-1"]);
  });
});
