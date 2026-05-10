import { describe, expect, it } from "vitest";
import { classifyReply, headersFromGmailPayload } from "../lib/reply-classification.js";

function classify(overrides: {
  fromAddress?: string;
  subject?: string;
  snippet?: string;
  headers?: Record<string, string>;
}) {
  return classifyReply({
    fromAddress: overrides.fromAddress ?? "alice@example.com",
    subject: overrides.subject ?? "Re: Quick intro",
    snippet: overrides.snippet ?? "Thanks for reaching out!",
    headers: overrides.headers ?? {},
  });
}

describe("classifyReply", () => {
  describe("BOUNCE detection", () => {
    it("classifies mailer-daemon sender as BOUNCE", () => {
      expect(classify({ fromAddress: "mailer-daemon@googlemail.com" })).toBe("BOUNCE");
    });

    it("classifies postmaster as BOUNCE", () => {
      expect(classify({ fromAddress: "postmaster@example.com" })).toBe("BOUNCE");
    });

    it("classifies 'Mail Delivery Subsystem' as BOUNCE", () => {
      expect(classify({ fromAddress: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" })).toBe("BOUNCE");
    });

    it("classifies undeliverable subject as BOUNCE", () => {
      expect(classify({ subject: "Undeliverable: Quick intro" })).toBe("BOUNCE");
    });

    it("classifies delivery failure subject as BOUNCE", () => {
      expect(classify({ subject: "Delivery Status Notification (Failure)" })).toBe("BOUNCE");
    });

    it("classifies 'Mail delivery failed' as BOUNCE", () => {
      expect(classify({ subject: "Mail Delivery Failed" })).toBe("BOUNCE");
    });

    it("classifies 'Address not found' as BOUNCE", () => {
      expect(classify({ subject: "Address not found" })).toBe("BOUNCE");
    });
  });

  describe("AUTO_REPLY detection via headers", () => {
    it("classifies Auto-Submitted: auto-replied as AUTO_REPLY", () => {
      expect(classify({ headers: { "auto-submitted": "auto-replied" } })).toBe("AUTO_REPLY");
    });

    it("classifies Auto-Submitted: auto-generated as AUTO_REPLY", () => {
      expect(classify({ headers: { "auto-submitted": "auto-generated" } })).toBe("AUTO_REPLY");
    });

    it("does NOT classify Auto-Submitted: no as AUTO_REPLY", () => {
      expect(classify({ headers: { "auto-submitted": "no" } })).toBe("REPLY");
    });

    it("classifies X-Autoreply header as AUTO_REPLY", () => {
      expect(classify({ headers: { "x-autoreply": "yes" } })).toBe("AUTO_REPLY");
    });

    it("classifies X-Auto-Response-Suppress header as AUTO_REPLY", () => {
      expect(classify({ headers: { "x-auto-response-suppress": "OOF" } })).toBe("AUTO_REPLY");
    });
  });

  describe("AUTO_REPLY detection via subject/body patterns", () => {
    it("classifies OOO subject as AUTO_REPLY", () => {
      expect(classify({ subject: "Out of Office: Quick intro" })).toBe("AUTO_REPLY");
    });

    it("classifies 'On vacation' subject as AUTO_REPLY", () => {
      expect(classify({ subject: "On vacation until Monday" })).toBe("AUTO_REPLY");
    });

    it("classifies OOO body snippet as AUTO_REPLY", () => {
      expect(classify({ snippet: "I am currently out of the office and will return on Monday." })).toBe("AUTO_REPLY");
    });

    it("classifies 'I will be back on' body as AUTO_REPLY", () => {
      expect(classify({ snippet: "I will be back on June 1st. For urgent matters contact..." })).toBe("AUTO_REPLY");
    });

    it("classifies automated response disclaimer in subject as AUTO_REPLY", () => {
      expect(classify({ subject: "This is an automated response" })).toBe("AUTO_REPLY");
    });

    it("classifies 'do not reply to this' as AUTO_REPLY", () => {
      expect(classify({ snippet: "Please do not reply to this message." })).toBe("AUTO_REPLY");
    });
  });

  describe("BOUNCE takes priority over AUTO_REPLY", () => {
    it("returns BOUNCE even when auto-submitted header is present", () => {
      expect(classify({
        fromAddress: "mailer-daemon@example.com",
        headers: { "auto-submitted": "auto-replied" },
      })).toBe("BOUNCE");
    });
  });

  describe("REPLY — human responses", () => {
    it("classifies normal reply as REPLY", () => {
      expect(classify({ snippet: "Thanks for reaching out! Would love to chat." })).toBe("REPLY");
    });

    it("classifies short reply as REPLY", () => {
      expect(classify({ snippet: "Interested, let's set up a call." })).toBe("REPLY");
    });

    it("classifies negative reply as REPLY", () => {
      expect(classify({ snippet: "Thanks but we're not looking for this right now." })).toBe("REPLY");
    });

    it("does not misclassify a reply that mentions office in passing", () => {
      expect(classify({ snippet: "We just moved to a new office, exciting times!" })).toBe("REPLY");
    });

    it("classifies with no subject or snippet as REPLY by default", () => {
      expect(classify({ subject: "", snippet: "" })).toBe("REPLY");
    });
  });
});

describe("headersFromGmailPayload", () => {
  it("extracts lowercased header name-value pairs", () => {
    const headers = headersFromGmailPayload({
      headers: [
        { name: "From", value: "alice@example.com" },
        { name: "Auto-Submitted", value: "auto-replied" },
        { name: "Subject", value: "Re: Hello" },
      ],
    });
    expect(headers).toEqual({
      from: "alice@example.com",
      "auto-submitted": "auto-replied",
      subject: "Re: Hello",
    });
  });

  it("handles null/undefined headers gracefully", () => {
    expect(headersFromGmailPayload({})).toEqual({});
    expect(headersFromGmailPayload({ headers: null })).toEqual({});
    expect(headersFromGmailPayload({ headers: [{ name: null, value: null }] })).toEqual({});
  });
});
