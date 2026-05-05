import { describe, it, expect } from "vitest";
import { buildSubjectLine } from "../lib/ai/generate-email.js";

describe("buildSubjectLine", () => {
  it("uses default template when template is null", () => {
    const subject = buildSubjectLine(null, { name: "Jane Smith" }, "Alex", { name: "Acme AI" });
    expect(subject).toBe("Interested in learning about Acme AI");
  });

  it("substitutes senderName", () => {
    const subject = buildSubjectLine("Hello from {{senderName}}", { name: "Jane" }, "Alex");
    expect(subject).toBe("Hello from Alex");
  });

  it("substitutes firstName from contact name", () => {
    const subject = buildSubjectLine("Hi {{firstName}}", { name: "Jane Smith" }, null);
    expect(subject).toBe("Hi Jane");
  });

  it("trims trailing whitespace when firstName substitutes empty", () => {
    const subject = buildSubjectLine("Hi {{firstName}}", { name: null }, null);
    expect(subject).toBe("Hi");
  });

  it("trims trailing whitespace when senderName substitutes empty", () => {
    const subject = buildSubjectLine("From {{senderName}}", { name: "Jane" }, null);
    expect(subject).toBe("From");
  });

  it("strips dangling separators when an explicit-template merge tag substitutes empty", () => {
    // Regression coverage for tidySubject. The default template no longer
    // ends in a senderName placeholder, but the same hazard exists for any
    // user template that ends in a merge tag — a missing value would land
    // in the inbox looking truncated without trailing-separator stripping.
    const subject = buildSubjectLine("Quick intro — {{senderName}}", { name: "Jane" }, null);
    expect(subject).toBe("Quick intro");
  });

  it("strips compounded trailing separators", () => {
    const subject = buildSubjectLine("Re: {{firstName}} — {{senderName}}", { name: null }, null);
    expect(subject).toBe("Re");
  });

  it("replaces all occurrences of a placeholder", () => {
    const subject = buildSubjectLine("{{senderName}} - {{senderName}}", { name: "Jane" }, "Alex");
    expect(subject).toBe("Alex - Alex");
  });

  it("handles template with no placeholders", () => {
    const subject = buildSubjectLine("Just reaching out", { name: "Jane" }, "Alex");
    expect(subject).toBe("Just reaching out");
  });

  it("substitutes company name placeholders", () => {
    const company = { name: "Momentum AI" };
    const subject = buildSubjectLine("Quick question about {{company}} / {{company_name}} / {{companyName}}", { name: "Jane" }, "Alex", company);
    expect(subject).toBe("Quick question about Momentum AI / Momentum AI / Momentum AI");
  });
});
