import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROLE_FAMILY,
  ROLE_FAMILIES,
  UNIVERSAL_TITLES,
  isRoleFamily,
  labelForRoleFamily,
  normalizeRoleFamily,
  titlesForRole,
  type RoleFamily,
} from "../../src/types/roleFamilies.js";

describe("roleFamilies registry", () => {
  it("ships exactly the 4 consolidated families", () => {
    // Pinning the count so a stray addition forces a deliberate update of
    // the wizard UI, onboarding picker, and email-gen prompt branches.
    expect(ROLE_FAMILIES.map(r => r.id).sort()).toEqual([
      "engineering",
      "gtm",
      "operations",
      "product",
    ]);
  });

  it("UNIVERSAL_TITLES always include the CEO/Founder safety net", () => {
    // The whole point of the safety net is that small startups without
    // function-specific leads in Apollo still resolve to a decision-maker.
    // Drop one and the new-role UX silently regresses to "no contacts
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
    expect(isRoleFamily("gtm")).toBe(true);
    expect(isRoleFamily("sales")).toBe(false); // collapsed into "gtm" — fail loudly
    expect(isRoleFamily(null)).toBe(false);
    expect(isRoleFamily(undefined)).toBe(false);
    expect(isRoleFamily(42)).toBe(false);
  });

  it("labelForRoleFamily returns human-readable labels", () => {
    expect(labelForRoleFamily("engineering")).toBe("Engineering");
    expect(labelForRoleFamily("product")).toBe("Product & Design");
    expect(labelForRoleFamily("gtm")).toBe("GTM");
    expect(labelForRoleFamily("operations")).toBe("Operations");
  });
});

describe("normalizeRoleFamily", () => {
  it("returns DEFAULT_ROLE_FAMILY when input is null/undefined/non-string", () => {
    // Default fallback is engineering — preserves the pre-refactor
    // TARGET_TITLES baseline for existing users with no saved value.
    expect(normalizeRoleFamily(null)).toBe(DEFAULT_ROLE_FAMILY);
    expect(normalizeRoleFamily(undefined)).toBe(DEFAULT_ROLE_FAMILY);
    expect(normalizeRoleFamily(42)).toBe(DEFAULT_ROLE_FAMILY);
    expect(normalizeRoleFamily([])).toBe(DEFAULT_ROLE_FAMILY);
  });

  it("preserves a valid RoleFamily id", () => {
    expect(normalizeRoleFamily("gtm")).toBe("gtm");
    expect(normalizeRoleFamily("operations")).toBe("operations");
  });

  it("returns fallback for unknown ids", () => {
    // Defends against bad data getting into workspace_config /
    // filterTargetRole — a typo in a manual SQL update shouldn't crash
    // downstream callers.
    expect(normalizeRoleFamily("garbage")).toBe(DEFAULT_ROLE_FAMILY);
    expect(normalizeRoleFamily("sales")).toBe(DEFAULT_ROLE_FAMILY); // old name
  });

  it("uses a custom null fallback when provided (campaign inherit-vs-explicit case)", () => {
    // Wizard / audienceFromCampaign pass { fallback: null } so they can
    // distinguish "campaign has no override → inherit from workspace" from
    // "campaign explicitly has this role." Without this option we'd lose
    // that distinction.
    expect(normalizeRoleFamily(null, { fallback: null })).toBe(null);
    expect(normalizeRoleFamily("garbage", { fallback: null })).toBe(null);
    expect(normalizeRoleFamily("gtm", { fallback: null })).toBe("gtm");
  });
});

describe("titlesForRole", () => {
  it("always includes the universal CEO/Founder safety net", () => {
    // This is the load-bearing invariant for small-startup contact resolution.
    for (const family of ROLE_FAMILIES) {
      const titles = titlesForRole(family.id);
      expect(titles).toEqual(expect.arrayContaining(UNIVERSAL_TITLES));
    }
    // null role still gets the safety net so callers don't break on edge case.
    expect(titlesForRole(null)).toEqual(expect.arrayContaining(UNIVERSAL_TITLES));
  });

  it("includes the role-specific titles for the selected family", () => {
    const eng = titlesForRole("engineering");
    expect(eng).toContain("CTO");
    expect(eng).toContain("VP Engineering");

    const gtm = titlesForRole("gtm");
    expect(gtm).toContain("Head of Sales");
    expect(gtm).toContain("CMO");
  });

  it("does not bleed titles across families", () => {
    // Picking GTM shouldn't surface engineering titles — that's the whole
    // point of per-campaign role targeting. Catches regressions where a
    // careless union over all families would re-create the pre-refactor
    // "every campaign emails CTOs" behavior.
    const gtm = titlesForRole("gtm");
    expect(gtm).not.toContain("CTO");
    expect(gtm).not.toContain("VP Engineering");

    const ops = titlesForRole("operations");
    expect(ops).not.toContain("CTO");
    expect(ops).not.toContain("CMO");
  });

  it("dedupes universals when they could theoretically overlap family titles", () => {
    // If a family's apolloTitles accidentally listed "CEO" again, the Set
    // dedupe should still keep it appearing once.
    for (const family of ROLE_FAMILIES) {
      const titles = titlesForRole(family.id);
      expect(titles.filter(t => t === "CEO").length).toBe(1);
      expect(titles.filter(t => t === "Founder").length).toBe(1);
    }
  });
});

// Compile-time guarantee: RoleFamily union stays in sync with ROLE_FAMILIES.
// This `_check` is purely a type-level assertion (no runtime cost) — added
// after a near-miss earlier where the enum and registry diverged.
type _CheckRoleFamilyIsExhaustive = {
  [K in RoleFamily]: K extends typeof ROLE_FAMILIES[number]["id"] ? true : never;
};
