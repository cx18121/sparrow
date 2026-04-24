import { describe, it, expect } from "vitest";
import {
  GENERIC_FALLBACK_BODY,
  GENERIC_FALLBACK_SUBJECT,
  HUMANIZER_SYSTEM_PROMPT,
  EMAIL_GENERATION_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  BUILT_IN_DEFAULT_TEMPLATE,
  DEFAULT_SUBJECT_TEMPLATE,
} from "../_lib/ai/prompts.js";

describe("GENERIC_FALLBACK_BODY", () => {
  it("includes the contact name", () => {
    expect(GENERIC_FALLBACK_BODY("Sarah", "Acme")).toContain("Sarah");
  });

  it("includes the company name", () => {
    expect(GENERIC_FALLBACK_BODY("Sarah", "Acme")).toContain("Acme");
  });

  it("starts with Hi [name]", () => {
    expect(GENERIC_FALLBACK_BODY("Sarah", "Acme")).toMatch(/^Hi Sarah/);
  });
});

describe("GENERIC_FALLBACK_SUBJECT", () => {
  it("is a non-empty string", () => {
    expect(typeof GENERIC_FALLBACK_SUBJECT).toBe("string");
    expect(GENERIC_FALLBACK_SUBJECT.length).toBeGreaterThan(0);
  });
});

describe("HUMANIZER_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof HUMANIZER_SYSTEM_PROMPT).toBe("string");
    expect(HUMANIZER_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("tells the AI not to restructure the email", () => {
    expect(HUMANIZER_SYSTEM_PROMPT.toLowerCase()).toContain("restructure");
  });

  it("lists AI vocabulary to cut", () => {
    expect(HUMANIZER_SYSTEM_PROMPT).toContain("leverage");
    expect(HUMANIZER_SYSTEM_PROMPT).toContain("synergy");
  });
});

describe("EMAIL_GENERATION_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof EMAIL_GENERATION_SYSTEM_PROMPT).toBe("string");
    expect(EMAIL_GENERATION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("references startups not investment banking", () => {
    expect(EMAIL_GENERATION_SYSTEM_PROMPT.toLowerCase()).toContain("startup");
    expect(EMAIL_GENERATION_SYSTEM_PROMPT.toLowerCase()).not.toContain("investment bank");
  });

  it("bans corporate jargon like leverage and synergy", () => {
    expect(EMAIL_GENERATION_SYSTEM_PROMPT).toContain("leverage");
    expect(EMAIL_GENERATION_SYSTEM_PROMPT).toContain("synergy");
  });
});

describe("RESEARCH_SYSTEM_PROMPT", () => {
  it("instructs the model to return NO_INTEREST_FOUND when nothing found", () => {
    expect(RESEARCH_SYSTEM_PROMPT).toContain("NO_INTEREST_FOUND");
  });

  it("asks for a single short phrase in second person", () => {
    expect(RESEARCH_SYSTEM_PROMPT.toLowerCase()).toContain("second person");
  });
});

describe("BUILT_IN_DEFAULT_TEMPLATE", () => {
  it("contains placeholder for contact name", () => {
    expect(BUILT_IN_DEFAULT_TEMPLATE).toContain("{{contact_name}}");
  });

  it("contains placeholder for sender name", () => {
    expect(BUILT_IN_DEFAULT_TEMPLATE).toContain("{{sender_name}}");
  });

  it("contains placeholder for interest hook", () => {
    expect(BUILT_IN_DEFAULT_TEMPLATE).toContain("{{interest_hook_reference}}");
  });
});

describe("DEFAULT_SUBJECT_TEMPLATE", () => {
  it("is a non-empty string", () => {
    expect(typeof DEFAULT_SUBJECT_TEMPLATE).toBe("string");
    expect(DEFAULT_SUBJECT_TEMPLATE.length).toBeGreaterThan(0);
  });

  it("contains senderName placeholder", () => {
    expect(DEFAULT_SUBJECT_TEMPLATE).toContain("{{senderName}}");
  });
});
