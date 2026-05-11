import { describe, expect, it } from "vitest";
import { CANONICAL_STAGES, mergeStages, stageSortKey } from "../_lib/stages.js";

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
