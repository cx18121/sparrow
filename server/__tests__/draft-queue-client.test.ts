import { describe, expect, it } from "vitest";

import {
  canSendDraft,
  draftReadiness,
  filterDrafts,
  getCompanyName,
  getRecipient,
  getRecipientName,
  htmlToEditableText,
  nextReviewDraft,
  sortDrafts,
  stripDraftHtml,
  textToDraftHtml,
} from "../../src/lib/draftQueue.js";

const leadDraft = {
  id: "lead-draft",
  subject: "Hello",
  body: "<p>First line</p><p>Second&nbsp;line</p>",
  createdAt: "2026-01-01T00:00:00.000Z",
  sentAt: null,
  contact: { name: "Sarah Chen", email: "sarah@example.com" },
  customContact: null,
  userLead: { company: { name: "Acme" } },
};

const customDraft = {
  id: "custom-draft",
  subject: "Hi",
  body: "Plain body",
  createdAt: "2026-01-03T00:00:00.000Z",
  sentAt: null,
  contact: null,
  customContact: { name: "Jordan Lee", email: "jordan@example.com", companyName: "Warm Intro Co" },
  userLead: null,
};

describe("Draft queue helpers", () => {
  it("derives recipient and company labels from Lead and Custom Contact drafts", () => {
    expect(getRecipient(leadDraft)).toBe("sarah@example.com");
    expect(getRecipientName(leadDraft)).toBe("Sarah Chen");
    expect(getCompanyName(leadDraft)).toBe("Acme");

    expect(getRecipient(customDraft)).toBe("jordan@example.com");
    expect(getRecipientName(customDraft)).toBe("Jordan Lee");
    expect(getCompanyName(customDraft)).toBe("Warm Intro Co");
  });

  it("normalizes Draft body text for table previews and edit mode", () => {
    expect(stripDraftHtml(leadDraft.body)).toBe("First line Second&nbsp;line");
    expect(htmlToEditableText("<p>Hello<br>there</p><p>Bye &amp; thanks</p>")).toBe("Hello\nthere\n\nBye & thanks");
    expect(textToDraftHtml("Hello\nthere\n\nBye")).toBe("<p style=\"margin:0 0 0.75em\">Hello<br>there</p><p style=\"margin:0 0 0.75em\">Bye</p>");
  });

  it("renders line-oriented email drafts with paragraph spacing", () => {
    expect(textToDraftHtml("Hi Sarah,\nIntro sentence.\nCompany sentence.\nAsk sentence.\nBest,\nAlex")).toBe(
      "<p style=\"margin:0 0 0.75em\">Hi Sarah,</p><p style=\"margin:0 0 0.75em\">Intro sentence.</p><p style=\"margin:0 0 0.75em\">Company sentence.</p><p style=\"margin:0 0 0.75em\">Ask sentence.</p><p style=\"margin:0 0 0.75em\">Best,<br>Alex</p>",
    );
  });

  it("classifies Draft readiness and sendability", () => {
    expect(draftReadiness(leadDraft).label).toBe("Ready");
    expect(canSendDraft(leadDraft)).toBe(true);

    expect(draftReadiness({ ...leadDraft, contact: { name: "Sarah", email: "" } }).label).toBe("Needs recipient");
    expect(draftReadiness({ ...leadDraft, subject: " " }).label).toBe("Needs edit");
    expect(draftReadiness({ ...leadDraft, body: "<p> </p>" }).label).toBe("Needs edit");
  });

  it("sorts and filters Drafts using the same queue semantics as the UI", () => {
    const needsRecipient = {
      ...leadDraft,
      id: "needs-recipient",
      contact: { name: "No Email", email: "" },
      createdAt: "2026-01-02T00:00:00.000Z",
    };
    const drafts = [leadDraft, customDraft, needsRecipient];

    expect(sortDrafts(drafts, { key: "createdAt", direction: "desc", tab: "draft" }).map(d => d.id)).toEqual([
      "custom-draft",
      "needs-recipient",
      "lead-draft",
    ]);
    expect(sortDrafts(drafts, { key: "name", direction: "asc", tab: "draft" }).map(d => d.id)).toEqual([
      "custom-draft",
      "needs-recipient",
      "lead-draft",
    ]);
    expect(filterDrafts(drafts, "needsRecipient").map(d => d.id)).toEqual(["needs-recipient"]);
    expect(filterDrafts(drafts, "ready").map(d => d.id)).toEqual(["lead-draft", "custom-draft"]);
  });

  it("finds the next ready Draft after a send", () => {
    const drafts = [
      { ...leadDraft, id: "first" },
      { ...leadDraft, id: "sent-current" },
      { ...leadDraft, id: "not-ready", subject: "" },
      { ...customDraft, id: "next-ready" },
    ];

    expect(nextReviewDraft(drafts, "sent-current", ["sent-current"])?.id).toBe("next-ready");
    expect(nextReviewDraft(drafts, "next-ready", ["next-ready"])?.id).toBe("first");
    expect(nextReviewDraft(drafts, null, ["first"])?.id).toBe("sent-current");
  });
});
