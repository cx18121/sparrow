import { describe, it, expect } from "vitest";
import { buildSenderContext } from "../lib/build-sender-context.js";

describe("buildSenderContext", () => {
  it("returns empty string for null input", () => {
    expect(buildSenderContext(null)).toBe("");
  });

  it("returns empty string for undefined input", () => {
    expect(buildSenderContext(undefined)).toBe("");
  });

  it("returns empty string when all fields are null", () => {
    expect(buildSenderContext({ name: null, bio: null, resumeText: null })).toBe("");
  });

  it("includes name when provided", () => {
    const ctx = buildSenderContext({ name: "Jane Smith" });
    expect(ctx).toContain("Name: Jane Smith");
  });

  it("includes bio when provided", () => {
    const ctx = buildSenderContext({ bio: "CS grad with ML experience" });
    expect(ctx).toContain("Background: CS grad with ML experience");
  });

  it("includes resume excerpt when provided", () => {
    const ctx = buildSenderContext({ resumeText: "B.S. Computer Science, GPA 3.9" });
    expect(ctx).toContain("Resume excerpt: B.S. Computer Science");
  });

  it("truncates resumeText to 500 chars", () => {
    const longResume = "x".repeat(1000);
    const ctx = buildSenderContext({ resumeText: longResume });
    const excerptPart = ctx.replace("Resume excerpt: ", "");
    expect(excerptPart.length).toBe(500);
  });

  it("joins multiple fields with commas", () => {
    const ctx = buildSenderContext({ name: "Jane", bio: "PM" });
    expect(ctx).toBe("Name: Jane, Background: PM");
  });

  it("omits undefined fields", () => {
    const ctx = buildSenderContext({ name: "Jane" });
    expect(ctx).not.toContain("Background");
    expect(ctx).not.toContain("Resume excerpt");
  });
});
