import { describe, it, expect } from "vitest";
import { buildSubjectLine } from "../_lib/ai/generate-email.js";

describe("buildSubjectLine", () => {
  it("uses default template when template is null", () => {
    const subject = buildSubjectLine(null, { name: "Jane Smith" }, "Alex");
    expect(subject).toBe("Quick intro — Alex");
  });

  it("substitutes senderName", () => {
    const subject = buildSubjectLine("Hello from {{senderName}}", { name: "Jane" }, "Alex");
    expect(subject).toBe("Hello from Alex");
  });

  it("substitutes firstName from contact name", () => {
    const subject = buildSubjectLine("Hi {{firstName}}", { name: "Jane Smith" }, null);
    expect(subject).toBe("Hi Jane");
  });

  it("leaves firstName empty when contact name is null", () => {
    const subject = buildSubjectLine("Hi {{firstName}}", { name: null }, null);
    expect(subject).toBe("Hi ");
  });

  it("leaves senderName empty when null", () => {
    const subject = buildSubjectLine("From {{senderName}}", { name: "Jane" }, null);
    expect(subject).toBe("From ");
  });

  it("replaces all occurrences of a placeholder", () => {
    const subject = buildSubjectLine("{{senderName}} - {{senderName}}", { name: "Jane" }, "Alex");
    expect(subject).toBe("Alex - Alex");
  });

  it("handles template with no placeholders", () => {
    const subject = buildSubjectLine("Just reaching out", { name: "Jane" }, "Alex");
    expect(subject).toBe("Just reaching out");
  });
});
