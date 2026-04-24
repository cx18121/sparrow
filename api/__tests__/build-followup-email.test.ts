import { describe, it, expect } from "vitest";
import { buildFollowUpEmail, DEFAULT_FOLLOW_UP_TEMPLATE } from "../_lib/build-followup-email.js";

describe("buildFollowUpEmail", () => {
  const baseContact = { firstName: "Sarah", name: "Sarah Chen", company: "Acme" };

  it("uses firstName when provided", () => {
    const { body } = buildFollowUpEmail(null, baseContact, "Alex", null);
    expect(body).toContain("Hi Sarah");
  });

  it("falls back to first word of name when firstName is null", () => {
    const { body } = buildFollowUpEmail(null, { firstName: null, name: "Sarah Chen", company: "Acme" }, "Alex", null);
    expect(body).toContain("Hi Sarah");
  });

  it("falls back to 'there' when both firstName and name are null", () => {
    const { body } = buildFollowUpEmail(null, { firstName: null, name: null, company: "Acme" }, "Alex", null);
    expect(body).toContain("Hi there");
  });

  it("substitutes company name", () => {
    const { body } = buildFollowUpEmail(null, baseContact, "Alex", null);
    expect(body).toContain("Acme");
  });

  it("falls back to 'your company' when company is null", () => {
    const { body } = buildFollowUpEmail(null, { ...baseContact, company: null }, "Alex", null);
    expect(body).toContain("your company");
  });

  it("substitutes senderName", () => {
    const { body } = buildFollowUpEmail(null, baseContact, "Alex Nguyen", null);
    expect(body).toContain("Alex Nguyen");
  });

  it("leaves empty string when senderName is null", () => {
    const { body } = buildFollowUpEmail(null, baseContact, null, null);
    expect(body).not.toContain("{{senderName}}");
  });

  it("uses custom template when provided", () => {
    const custom = "Hey {{firstName}}, still keen to chat about {{company}}. — {{senderName}}";
    const { body } = buildFollowUpEmail(custom, baseContact, "Alex", null);
    expect(body).toBe("Hey Sarah, still keen to chat about Acme. — Alex");
  });

  it("uses DEFAULT_FOLLOW_UP_TEMPLATE when template is null", () => {
    const { body } = buildFollowUpEmail(null, baseContact, "Alex", null);
    expect(body).toContain("follow up");
  });

  it("prepends Re: to original subject", () => {
    const { subject } = buildFollowUpEmail(null, baseContact, "Alex", "Quick intro — Alex");
    expect(subject).toBe("Re: Quick intro — Alex");
  });

  it("strips existing Re: prefix before prepending", () => {
    const { subject } = buildFollowUpEmail(null, baseContact, "Alex", "Re: Quick intro");
    expect(subject).toBe("Re: Quick intro");
  });

  it("strips multiple Re: prefixes", () => {
    const { subject } = buildFollowUpEmail(null, baseContact, "Alex", "Re: Re: Quick intro");
    expect(subject).toBe("Re: Quick intro");
  });

  it("uses fallback subject when originalSubject is null", () => {
    const { subject } = buildFollowUpEmail(null, baseContact, "Alex", null);
    expect(subject).toBe("Following up");
  });
});
