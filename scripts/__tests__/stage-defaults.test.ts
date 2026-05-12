import { describe, it, expect } from "vitest";
import {
  defaultStageFromTags,
  defaultStageRuleFromTags,
  STAGE_INFERRED_SIGNAL,
  STAGE_RULES,
} from "../_lib/stage-defaults.js";

describe("defaultStageFromTags", () => {
  it("returns null for empty input", () => {
    expect(defaultStageFromTags(null)).toBeNull();
    expect(defaultStageFromTags(undefined)).toBeNull();
    expect(defaultStageFromTags([])).toBeNull();
  });

  it("returns null when no rule matches", () => {
    // Tags exist but none are in the rule set.
    expect(defaultStageFromTags(["vertical:fintech", "tech:ai"])).toBeNull();
    // Investor we deliberately skipped due to mixed thesis (coatue's venture
    // fund does seed; skip-rule documented in STAGE_RULES preamble).
    expect(defaultStageFromTags(["investor:coatue"])).toBeNull();
    expect(defaultStageFromTags(["investor:khosla"])).toBeNull();
  });

  it("infers Seed from signal:yc-backed", () => {
    expect(defaultStageFromTags(["signal:yc-backed"])).toBe("Seed");
  });

  it("infers Series C+ from growth-equity investor tags", () => {
    expect(defaultStageFromTags(["investor:insight"])).toBe("Series C+");
    expect(defaultStageFromTags(["investor:general-atlantic"])).toBe("Series C+");
    expect(defaultStageFromTags(["investor:summit"])).toBe("Series C+");
    expect(defaultStageFromTags(["investor:tcv"])).toBe("Series C+");
    expect(defaultStageFromTags(["investor:iconiq"])).toBe("Series C+");
  });

  it("infers Series B from investor:battery", () => {
    expect(defaultStageFromTags(["investor:battery"])).toBe("Series B");
  });

  it("infers Seed from seed-focused investor tags", () => {
    expect(defaultStageFromTags(["investor:boxgroup"])).toBe("Seed");
    expect(defaultStageFromTags(["investor:initialized"])).toBe("Seed");
    expect(defaultStageFromTags(["investor:hoxton"])).toBe("Seed");
    expect(defaultStageFromTags(["investor:pear"])).toBe("Seed");
  });

  it("picks the highest stage when multiple rules match", () => {
    // YC alum that later took Insight money — late-stage investor presence
    // wins because the company is at least at that stage.
    expect(
      defaultStageFromTags(["signal:yc-backed", "investor:insight"]),
    ).toBe("Series C+");
    // BoxGroup + General Atlantic — Series C+ wins over Seed.
    expect(
      defaultStageFromTags(["investor:boxgroup", "investor:general-atlantic"]),
    ).toBe("Series C+");
    // Battery + Initialized — Series B wins over Seed.
    expect(
      defaultStageFromTags(["investor:battery", "investor:initialized"]),
    ).toBe("Series B");
  });

  it("is robust against irrelevant tags surrounding the matching rule", () => {
    expect(
      defaultStageFromTags([
        "vertical:fintech",
        "tech:ai",
        "size:big-team",
        "investor:insight",
        "region:us",
      ]),
    ).toBe("Series C+");
  });
});

describe("defaultStageRuleFromTags", () => {
  it("returns the winning rule with rationale", () => {
    const rule = defaultStageRuleFromTags(["investor:battery"]);
    expect(rule?.matchTag).toBe("investor:battery");
    expect(rule?.stage).toBe("Series B");
    expect(rule?.rationale).toContain("Battery");
  });

  it("returns the rule for the highest stage on tiebreak", () => {
    const rule = defaultStageRuleFromTags([
      "signal:yc-backed",
      "investor:tcv",
    ]);
    expect(rule?.stage).toBe("Series C+");
    expect(rule?.matchTag).toBe("investor:tcv");
  });

  it("returns null when nothing matches", () => {
    expect(defaultStageRuleFromTags(["vertical:fintech"])).toBeNull();
  });
});

describe("STAGE_INFERRED_SIGNAL", () => {
  it("is the canonical signal: tag for inferred rows", () => {
    // The backfill script and upsert path both write this tag; pin its
    // exact value so anyone querying signal:stage-inferred isn't surprised.
    expect(STAGE_INFERRED_SIGNAL).toBe("signal:stage-inferred");
  });
});

describe("STAGE_RULES export", () => {
  it("includes the STATE.md-documented rules at minimum", () => {
    const tags = STAGE_RULES.map(r => r.matchTag);
    // Anchor rules from STATE.md pickup #1's investor-based inference list:
    //   insight/general-atlantic/summit → Series C+
    //   battery → Series B
    //   boxgroup/initialized → Seed
    expect(tags).toContain("signal:yc-backed");
    expect(tags).toContain("investor:insight");
    expect(tags).toContain("investor:general-atlantic");
    expect(tags).toContain("investor:summit");
    expect(tags).toContain("investor:battery");
    expect(tags).toContain("investor:boxgroup");
    expect(tags).toContain("investor:initialized");
  });
});
