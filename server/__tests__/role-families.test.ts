import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROLE_FAMILIES,
  MAX_ROLES_PER_CAMPAIGN,
  ROLE_FAMILIES,
  UNIVERSAL_TITLES,
  isRoleFamily,
  labelForRoleFamily,
  normalizeRoleFamilies,
  titlesForRoles,
} from "../../src/types/roleFamilies.js";

describe("roleFamilies registry", () => {
  it("UNIVERSAL_TITLES always include the CEO/Founder safety net", () => {
    // The whole point of the safety net is that small startups without
    // function-specific leads in Apollo still resolve to a decision-maker.
    // Drop one and the new-rolefamily UX silently regresses to "no contacts
    // returned at small startups" — same bug we had pre-refactor.
    expect(UNIVERSAL_TITLES).toEqual(expect.arrayContaining(["Founder", "Co-Founder", "CEO"]));
  });

  it("every role family has at least one Apollo title beyond the universals", () => {
    // A family with no role-specific titles is functionally identical to
    // picking nothing, which defeats the purpose of having that family.
    for (const family of ROLE_FAMILIES) {
      expect(family.apolloTitles.length).toBeGreaterThan(0);
    }
  });

  it("isRoleFamily accepts known ids, rejects junk", () => {
    expect(isRoleFamily("engineering")).toBe(true);
    expect(isRoleFamily("sales")).toBe(true);
    expect(isRoleFamily("not-a-family")).toBe(false);
    expect(isRoleFamily(null)).toBe(false);
    expect(isRoleFamily(undefined)).toBe(false);
    expect(isRoleFamily(42)).toBe(false);
  });

  it("labelForRoleFamily returns human-readable labels", () => {
    expect(labelForRoleFamily("engineering")).toBe("Engineering");
    expect(labelForRoleFamily("product")).toBe("Product & Design");
  });
});

describe("normalizeRoleFamilies", () => {
  it("returns the default family when input is null/undefined/non-array", () => {
    expect(normalizeRoleFamilies(null)).toEqual(DEFAULT_ROLE_FAMILIES);
    expect(normalizeRoleFamilies(undefined)).toEqual(DEFAULT_ROLE_FAMILIES);
    expect(normalizeRoleFamilies("engineering")).toEqual(DEFAULT_ROLE_FAMILIES);
    expect(normalizeRoleFamilies({})).toEqual(DEFAULT_ROLE_FAMILIES);
  });

  it("preserves a clean RoleFamily array", () => {
    expect(normalizeRoleFamilies(["engineering", "sales"])).toEqual(["engineering", "sales"]);
  });

  it("filters out unknown ids", () => {
    // Defends against bad data getting into workspace_config / filterTargetRoles
    // — a typo in a manual SQL update shouldn't crash searchContacts callers.
    expect(normalizeRoleFamilies(["engineering", "garbage", "sales"])).toEqual([
      "engineering",
      "sales",
    ]);
  });

  it("dedupes repeated ids", () => {
    expect(normalizeRoleFamilies(["sales", "sales", "engineering"])).toEqual([
      "sales",
      "engineering",
    ]);
  });

  it("enforces the per-campaign cap", () => {
    // Cap intentionally lives in normalizeRoleFamilies (not just the UI) so
    // a user who patches the API or session storage cannot exceed the cap.
    expect(MAX_ROLES_PER_CAMPAIGN).toBe(3);
    const tooMany = ["engineering", "product", "sales", "marketing", "operations", "recruiting"];
    expect(normalizeRoleFamilies(tooMany).length).toBe(MAX_ROLES_PER_CAMPAIGN);
  });

  it("uses a custom fallback when provided (wizard inherit-vs-explicit case)", () => {
    // Wizard passes { fallback: [] } so it can distinguish "campaign explicitly
    // has no roles → inherit from workspace" from "campaign has these roles."
    // Without this option we'd lose that distinction.
    expect(normalizeRoleFamilies(null, { fallback: [] })).toEqual([]);
    expect(normalizeRoleFamilies([], { fallback: [] })).toEqual([]);
    expect(normalizeRoleFamilies([], { fallback: ["sales"] })).toEqual(["sales"]);
  });
});

describe("titlesForRoles", () => {
  it("always includes the universal CEO/Founder safety net", () => {
    // This is the load-bearing invariant for small-startup contact resolution.
    for (const family of ROLE_FAMILIES) {
      const titles = titlesForRoles([family.id]);
      expect(titles).toEqual(expect.arrayContaining(UNIVERSAL_TITLES));
    }
    // Empty input still gets the safety net so callers don't break on edge case.
    expect(titlesForRoles([])).toEqual(expect.arrayContaining(UNIVERSAL_TITLES));
  });

  it("includes the role-specific titles for selected families", () => {
    const titles = titlesForRoles(["engineering"]);
    expect(titles).toContain("CTO");
    expect(titles).toContain("VP Engineering");
  });

  it("unions titles across multiple families with no duplicates", () => {
    // Founder/Co-Founder/CEO appear in EVERY family's resolved set via
    // UNIVERSAL_TITLES — they must not multiply, since duplicate titles
    // in Apollo's person_titles waste the request size without changing
    // results.
    const titles = titlesForRoles(["engineering", "sales"]);
    const founderCount = titles.filter(t => t === "Founder").length;
    expect(founderCount).toBe(1);
    expect(titles).toContain("CTO");
    expect(titles).toContain("Head of Sales");
  });

  it("ignores unknown families gracefully (paranoia for bad-data inputs)", () => {
    const titles = titlesForRoles(["engineering", "garbage" as never]);
    expect(titles).toContain("CTO");
    // Falls back to the safety net + engineering — no crash.
  });
});
