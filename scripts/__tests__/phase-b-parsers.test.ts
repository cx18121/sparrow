import { describe, it, expect } from "vitest";
import {
  buildFelicisStageMap,
  normalizeFelicisStage,
} from "../ingest-felicis.js";
import {
  normalizeCostanoaStage,
  stageFromTextCells,
} from "../ingest-costanoa.js";

// Fixture: a slice of the Felicis page HTML that contains two stage
// taxonomy chunks (Series A and " Series C" with leading-space) plus
// non-stage chunks that should NOT match. Backslash-quote escaping
// mirrors what `self.__next_f.push` writes into the page source.
//
// Chunk-stream prelude (`\\n` before the first chunk) mirrors the live
// page — chunks accumulate across push calls and are joined with `\n`
// separators, so the STAGE_CHUNK_RE anchor `(?:^|\\n)` requires the
// newline to be present before the chunk id. A first chunk that lands
// at the start of a push string with no preceding `\\n` would NOT match
// in the wild either; that's an accepted ~1-chunk-loss tradeoff in
// exchange for not collecting chunk-id substrings from inside other JSON.
const FELICIS_HTML_FIXTURE = `<script>self.__next_f.push([1, "\\n5a:{\\"_id\\":\\"91fe080a-4d8e-4e9e-a0c7-9b7151ca677e\\",\\"order\\":1,\\"slug\\":\\"$5b\\",\\"title\\":\\"Series A\\"}\\n34:{\\"_id\\":\\"cda544e1\\",\\"_type\\":\\"company\\",\\"name\\":\\"Adyen\\"}\\nf8:{\\"_id\\":\\"ce53a69b-5fcc-4d39-992e-7d6c59a09a41\\",\\"order\\":4,\\"slug\\":\\"$f9\\",\\"title\\":\\" Series C\\"}\\n5e:{\\"_id\\":\\"67ee15d2\\",\\"slug\\":\\"$5f\\",\\"title\\":\\"Infrastructure\\"}"])</script>`;

describe("buildFelicisStageMap", () => {
  it("returns an empty map for HTML with no chunks", () => {
    expect(buildFelicisStageMap("").size).toBe(0);
    expect(buildFelicisStageMap("<html><body>nothing here</body></html>").size).toBe(0);
  });

  it("matches stage chunks by their _id/order/slug/title shape", () => {
    const map = buildFelicisStageMap(FELICIS_HTML_FIXTURE);
    // Two stage chunks (5a, f8) — the Infrastructure chunk (5e) lacks the
    // `order` anchor field so it's correctly excluded; chunk 34 is a
    // company chunk and also correctly excluded.
    expect(map.size).toBe(2);
    expect(map.get("5a")).toBe("Series A");
    // Leading-space title is normalized.
    expect(map.get("f8")).toBe("Series C");
  });

  it("does NOT match non-stage chunks even when they have a title field", () => {
    // The "Infrastructure" chunk in the fixture has _id + slug + title but
    // is missing `order`, so the STAGE_CHUNK_RE anchor rejects it. This is
    // the property that prevents stage map pollution from sector chunks.
    const map = buildFelicisStageMap(FELICIS_HTML_FIXTURE);
    expect([...map.values()]).not.toContain("Infrastructure");
  });
});

describe("normalizeFelicisStage", () => {
  it("returns canonical Series A-F as-is", () => {
    expect(normalizeFelicisStage("Series A")).toBe("Series A");
    expect(normalizeFelicisStage("Series B")).toBe("Series B");
    expect(normalizeFelicisStage("Series F")).toBe("Series F");
  });

  it("trims surrounding whitespace (Felicis emits ' Series C' for one chunk)", () => {
    expect(normalizeFelicisStage(" Series C")).toBe("Series C");
    expect(normalizeFelicisStage("Series C ")).toBe("Series C");
  });

  it("normalizes Seed and Pre-Seed variants", () => {
    expect(normalizeFelicisStage("Seed")).toBe("Seed");
    expect(normalizeFelicisStage("seed")).toBe("Seed");
    expect(normalizeFelicisStage("Pre-Seed")).toBe("Pre-Seed");
    expect(normalizeFelicisStage("PreSeed")).toBe("Pre-Seed");
    expect(normalizeFelicisStage("pre-seed")).toBe("Pre-Seed");
  });

  it("returns null for empty / non-canonical strings", () => {
    expect(normalizeFelicisStage("")).toBeNull();
    expect(normalizeFelicisStage("   ")).toBeNull();
    expect(normalizeFelicisStage("Growth")).toBeNull();
    expect(normalizeFelicisStage("Series Z")).toBeNull();
    expect(normalizeFelicisStage("Acquired")).toBeNull();
  });
});

describe("normalizeCostanoaStage", () => {
  it("returns canonical Series A-F as-is", () => {
    expect(normalizeCostanoaStage("Series A")).toBe("Series A");
    expect(normalizeCostanoaStage("Series D")).toBe("Series D");
  });

  it("uppercases the letter when authors used lowercase", () => {
    // The current normalizer accepts case-insensitive Series-X; this test
    // pins that behavior so a future regex tightening doesn't silently
    // drop cells like "series a".
    expect(normalizeCostanoaStage("series a")).toBe("Series A");
    expect(normalizeCostanoaStage("Series b")).toBe("Series B");
  });

  it("normalizes Seed / Pre-Seed variants", () => {
    expect(normalizeCostanoaStage("Seed")).toBe("Seed");
    expect(normalizeCostanoaStage("Pre-Seed")).toBe("Pre-Seed");
    expect(normalizeCostanoaStage("PreSeed")).toBe("Pre-Seed");
  });

  it("returns null for nullish, empty, or non-canonical input", () => {
    expect(normalizeCostanoaStage(null)).toBeNull();
    expect(normalizeCostanoaStage(undefined)).toBeNull();
    expect(normalizeCostanoaStage("")).toBeNull();
    expect(normalizeCostanoaStage("   ")).toBeNull();
    expect(normalizeCostanoaStage("Growth")).toBeNull();
    expect(normalizeCostanoaStage("IPO")).toBeNull();
  });
});

describe("stageFromTextCells", () => {
  it("returns null for nullish / empty input", () => {
    expect(stageFromTextCells(undefined)).toBeNull();
    expect(stageFromTextCells([])).toBeNull();
  });

  it("prefers the cell captioned 'COSTANOA'S Initial investment'", () => {
    const cells = [
      { caption: null, text: "Series B" },
      { caption: "COSTANOA'S Initial investment", text: "Seed" },
      { caption: null, text: "Series C" },
    ];
    // Initial-investment cell wins — that's the entry round, the canonical
    // stage we want to record on Company.stage.
    expect(stageFromTextCells(cells)).toBe("Seed");
  });

  it("matches the caption case-insensitively and tolerates surrounding whitespace", () => {
    const cells = [
      { caption: "  costanoa's initial investment  ", text: "Series A" },
      { caption: null, text: "Series B" },
    ];
    expect(stageFromTextCells(cells)).toBe("Series A");
  });

  it("matches the caption with smart quote (Costanoa's actual page uses ’ not ')", () => {
    const cells = [
      { caption: "COSTANOA’S Initial investment", text: "Series B" },
      { caption: null, text: "Seed" },
    ];
    // The matcher uses `/initial investment/` so the apostrophe variant
    // doesn't matter — what matters is the literal substring "initial
    // investment". Pin this so a future tightening to require "costanoa's"
    // explicitly doesn't break smart-quote rows.
    expect(stageFromTextCells(cells)).toBe("Series B");
  });

  it("falls back to the first canonical-stage cell when no initial-investment caption is present", () => {
    const cells = [
      { caption: null, text: "not a stage" },
      { caption: null, text: "Series C" },
      { caption: null, text: "Seed" },
    ];
    expect(stageFromTextCells(cells)).toBe("Series C");
  });

  it("returns null when no cell has a recognizable stage", () => {
    const cells = [
      { caption: "Founding year", text: "2018" },
      { caption: "HQ", text: "San Francisco" },
    ];
    expect(stageFromTextCells(cells)).toBeNull();
  });

  it("ignores the initial-investment caption if its text does not normalize", () => {
    // E.g. cell exists but text was edited away or set to a non-stage label.
    // Should fall back to the first canonical-stage cell.
    const cells = [
      { caption: "COSTANOA'S Initial investment", text: "TBD" },
      { caption: null, text: "Series A" },
    ];
    expect(stageFromTextCells(cells)).toBe("Series A");
  });
});
