import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockGetSupabaseAdmin,
  mockDecrypt,
  mockCheckEmailSendQuota,
  mockReserveEmailSendQuota,
  mockClaimForSending,
  mockMarkSent,
  mockMarkFailed,
  mockGmailSend,
} = vi.hoisted(() => {
  const mockPrisma = {
    email: { findUnique: vi.fn() },
    userLead: { update: vi.fn() },
    customContact: { update: vi.fn() },
  };
  return {
    mockPrisma,
    mockGetSupabaseAdmin: vi.fn(),
    mockDecrypt: vi.fn(),
    mockCheckEmailSendQuota: vi.fn(),
    mockReserveEmailSendQuota: vi.fn(),
    mockClaimForSending: vi.fn(),
    mockMarkSent: vi.fn(),
    mockMarkFailed: vi.fn(),
    mockGmailSend: vi.fn(),
  };
});

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

vi.mock("../lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: mockGetSupabaseAdmin,
}));

vi.mock("../lib/crypto.js", () => ({
  decrypt: mockDecrypt,
}));

vi.mock("../lib/rate-limit.js", () => ({
  checkEmailSendQuota: mockCheckEmailSendQuota,
  reserveEmailSendQuota: mockReserveEmailSendQuota,
  QuotaError: class QuotaError extends Error {
    status = 429;
  },
}));

vi.mock("../lib/email-status.js", () => ({
  SENDABLE_STATUSES: ["draft", "failed"],
  claimForSending: mockClaimForSending,
  markSent: mockMarkSent,
  markFailed: mockMarkFailed,
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: vi.fn().mockImplementation(function OAuth2() { return { setCredentials: vi.fn() } }) },
    gmail: vi.fn(() => ({
      users: {
        messages: { send: mockGmailSend },
        // sendDraft / sendTestDraft call this to resolve the Gmail address
        // for keying the daily send quota.
        getProfile: vi.fn().mockResolvedValue({ data: { emailAddress: "sender@gmail.test" } }),
      },
    })),
  },
}));

import { sendDraft, sendTestDraft } from "../lib/send-draft.js";

const USER_ID = "user-1";

function mockProfile() {
  const download = vi.fn().mockResolvedValue({ data: new Blob(["resume bytes"]), error: null });
  const chain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        google_refresh_token_encrypted: "encrypted-refresh",
        workspace_config: { sendingLimits: { dailyMax: 100 }, files: [] },
      },
      error: null,
    }),
    storage: { from: vi.fn(() => ({ download })) },
  };
  mockGetSupabaseAdmin.mockReturnValue(chain);
  return { chain, download };
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & {
    __dashCache?: Map<string, { data: unknown; ts: number }>;
  }).__dashCache = new Map();
  mockProfile();
  mockDecrypt.mockReturnValue("refresh-token");
  mockCheckEmailSendQuota.mockResolvedValue(undefined);
  mockReserveEmailSendQuota.mockResolvedValue(vi.fn()); // returns a no-op release fn
  mockClaimForSending.mockResolvedValue(true);
  mockGmailSend.mockResolvedValue({ data: { id: "gmail-message" } });
  mockMarkSent.mockResolvedValue({ id: "email-1", status: "sent" });
});

describe("sendDraft", () => {
  it("marks the owning Lead EMAILED after Gmail send succeeds", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email-1",
      userLeadId: "lead-1",
      customContactId: null,
      status: "draft",
      subject: "Hello",
      body: "Body",
      attachmentIds: [],
      contact: { email: "sarah@example.com", name: "Sarah Chen" },
      customContact: null,
      userLead: { userId: USER_ID },
    });

    await sendDraft("email-1", USER_ID);

    expect(mockMarkSent).toHaveBeenCalledWith("email-1", undefined);
    expect(mockPrisma.userLead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { status: "EMAILED" },
    });
    expect(mockPrisma.customContact.update).not.toHaveBeenCalled();
  });

  it("marks the owning Custom Contact EMAILED after Gmail send succeeds", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email-1",
      userLeadId: null,
      customContactId: "cc-1",
      status: "draft",
      subject: "Hello",
      body: "Body",
      attachmentIds: [],
      contact: null,
      customContact: { email: "jordan@example.com", name: "Jordan Lee", userId: USER_ID },
      userLead: null,
    });

    await sendDraft("email-1", USER_ID);

    expect(mockMarkSent).toHaveBeenCalledWith("email-1", undefined);
    expect(mockPrisma.customContact.update).toHaveBeenCalledWith({
      where: { id: "cc-1" },
      data: { status: "EMAILED" },
    });
    expect(mockPrisma.userLead.update).not.toHaveBeenCalled();
  });

  it("sends the uploaded resume when attachmentIds contains the resume default", async () => {
    const { download } = mockProfile();
    mockGetSupabaseAdmin().maybeSingle.mockResolvedValue({
      data: {
        google_refresh_token_encrypted: "encrypted-refresh",
        resume_path: `${USER_ID}/resume.pdf`,
        workspace_config: {
          sendingLimits: { dailyMax: 100 },
          resumeFileName: "resume.pdf",
          files: [],
        },
      },
      error: null,
    });
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email-1",
      userLeadId: "lead-1",
      customContactId: null,
      status: "draft",
      subject: "Hello",
      body: "Body",
      attachmentIds: ["resume"],
      contact: { email: "sarah@example.com", name: "Sarah Chen" },
      customContact: null,
      userLead: { userId: USER_ID },
    });

    await sendDraft("email-1", USER_ID);

    expect(download).toHaveBeenCalledWith(`${USER_ID}/resume.pdf`);
    const raw = (mockGmailSend.mock.calls[0]?.[0] as { requestBody: { raw: string } }).requestBody.raw;
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain('filename="resume.pdf"');
  });

  it("invalidates every warm Draft/Sent dashboard cache entry for the sender", async () => {
    const cache = (globalThis as typeof globalThis & {
      __dashCache?: Map<string, { data: unknown; ts: number }>;
    }).__dashCache!;
    cache.set(`${USER_ID}:global`, { data: { drafts: [{ id: "email-1" }], sent: [] }, ts: Date.now() });
    cache.set(`${USER_ID}:campaign:campaign-1`, { data: { drafts: [{ id: "email-1" }], sent: [] }, ts: Date.now() });
    cache.set("other-user:global", { data: { drafts: [{ id: "other-email" }], sent: [] }, ts: Date.now() });

    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email-1",
      userLeadId: "lead-1",
      customContactId: null,
      status: "draft",
      subject: "Hello",
      body: "Body",
      attachmentIds: [],
      contact: { email: "sarah@example.com", name: "Sarah Chen" },
      customContact: null,
      userLead: { userId: USER_ID },
    });

    await sendDraft("email-1", USER_ID);

    expect(cache.has(`${USER_ID}:global`)).toBe(false);
    expect(cache.has(`${USER_ID}:campaign:campaign-1`)).toBe(false);
    expect(cache.has("other-user:global")).toBe(true);
  });
});

describe("sendTestDraft", () => {
  it("rejects an obviously invalid recipient address", async () => {
    await expect(sendTestDraft("email-1", USER_ID, "not-an-email")).rejects.toThrow(
      /valid recipient/i
    );
    expect(mockGmailSend).not.toHaveBeenCalled();
  });

  it("sends to the override recipient and leaves the draft as draft", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email-1",
      userLeadId: "lead-1",
      customContactId: null,
      status: "draft",
      subject: "Hello",
      body: "Body",
      attachmentIds: [],
      userLead: { userId: USER_ID },
      customContact: null,
    });

    const result = await sendTestDraft("email-1", USER_ID, "Me@Example.com");

    expect(result).toEqual({ recipient: "me@example.com" });
    expect(mockGmailSend).toHaveBeenCalledTimes(1);
    const raw = (mockGmailSend.mock.calls[0]?.[0] as { requestBody: { raw: string } }).requestBody.raw;
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("me@example.com");
    expect(decoded).toContain("[TEST]");

    // Test sends MUST NOT mark the draft as sent or the recipient as EMAILED.
    expect(mockMarkSent).not.toHaveBeenCalled();
    expect(mockPrisma.userLead.update).not.toHaveBeenCalled();
    expect(mockPrisma.customContact.update).not.toHaveBeenCalled();
    expect(mockClaimForSending).not.toHaveBeenCalled();
  });

  it("rejects when the draft is owned by a different user", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email-1",
      userLeadId: "lead-1",
      customContactId: null,
      status: "draft",
      subject: "Hello",
      body: "Body",
      attachmentIds: [],
      userLead: { userId: "other-user" },
      customContact: null,
    });

    await expect(sendTestDraft("email-1", USER_ID, "me@example.com")).rejects.toThrow(/not found/i);
    expect(mockGmailSend).not.toHaveBeenCalled();
  });
});
