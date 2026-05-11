import { describe, expect, it } from "vitest";
import {
  CANONICAL_STAGES,
  expandStageFilter,
  mergeStages,
  stageSortKey,
} from "../_lib/stages.js";

describe("CANONICAL_STAGES", () => {
  it("is ordered by funding progression", () => {
    const earlyIdx = CANONICAL_STAGES.indexOf("Seed");
    const lateIdx = CANONICAL_STAGES.indexOf("Series E");
    expect(earlyIdx).toBeLessThan(lateIdx);
  });

  it("keeps Series C+ in the list as the legacy aggregation bucket", () => {
    expect(CANONICAL_STAGES).toContain("Series C+");
  });
});

describe("stageSortKey", () => {
  it("returns the canonical index for a known stage", () => {
    expect(stageSortKey("Seed")).toBe(1);
    expect(stageSortKey("Series A")).toBe(2);
  });

  it("sorts unknown stages to the end", () => {
    expect(stageSortKey("foo")).toBeGreaterThan(stageSortKey("Series C+"));
  });

  it("returns max for null/undefined", () => {
    expect(stageSortKey(null)).toBe(Number.MAX_SAFE_INTEGER);
    expect(stageSortKey(undefined)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("mergeStages", () => {
  it("surfaces all canonical stages even when only a few exist in DB", () => {
    const realized = ["Seed", "Series A"];
    const merged = mergeStages(realized);
    expect(merged).toContain("Series C");
    expect(merged).toContain("Series D");
    expect(merged).toContain("Series E");
  });

  it("preserves canonical ordering with realized stages first", () => {
    const realized = ["Series A", "Seed"];
    const merged = mergeStages(realized);
    expect(merged.slice(0, 2)).toEqual(["Seed", "Series A"]);
  });

  it("deduplicates — a stage realized in DB and canonical appears once", () => {
    const merged = mergeStages(["Series C"]);
    expect(merged.filter((s) => s === "Series C")).toHaveLength(1);
  });

  it("appends non-canonical realized stages at the end alphabetically", () => {
    const merged = mergeStages(["Seed", "ZZZ Custom Stage", "AAA Legacy"]);
    expect(merged.slice(-2)).toEqual(["AAA Legacy", "ZZZ Custom Stage"]);
  });

  it("works with an empty realized list", () => {
    const merged = mergeStages([]);
    expect(merged).toEqual([...CANONICAL_STAGES]);
  });
});

describe("expandStageFilter", () => {
  it("returns the filter itself for exact-stage filters (no '+')", () => {
    expect(expandStageFilter("Seed")).toEqual(["Seed"]);
    expect(expandStageFilter("Series A")).toEqual(["Series A"]);
    expect(expandStageFilter("Series D")).toEqual(["Series D"]);
  });

  it("'Series C+' matches itself and every canonical stage ≥ Series C", () => {
    const matches = expandStageFilter("Series C+");
    expect(matches).toContain("Series C+");
    expect(matches).toContain("Series C");
    expect(matches).toContain("Series D");
    expect(matches).toContain("Series E");
  });

  it("'Series C+' does not match earlier stages", () => {
    const matches = expandStageFilter("Series C+");
    expect(matches).not.toContain("Series A");
    expect(matches).not.toContain("Series B");
    expect(matches).not.toContain("Seed");
    expect(matches).not.toContain("Pre-Seed");
  });

  it("falls back to exact match for unknown '+' values", () => {
    // No ordinal for "Series Q" — keep the literal so we don't drop the
    // user's intent. Caller is responsible for surfacing real values.
    expect(expandStageFilter("Series Q+")).toEqual(["Series Q+"]);
  });

  it("returns a unique list (no dupes)", () => {
    const matches = expandStageFilter("Series C+");
    expect(new Set(matches).size).toBe(matches.length);
  });
});
