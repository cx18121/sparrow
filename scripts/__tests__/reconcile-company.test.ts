import { describe, it, expect } from "vitest";
import { reconcileCompany } from "../_lib/reconcile-company.js";

describe("reconcileCompany", () => {
  describe("inserts (existing = null)", () => {
    it("passes incoming tags through unchanged", () => {
      const result = reconcileCompany(null, {
        source: "yc",
        tags: ["industry:fintech", "yc-backed"],
        isVerified: true,
        qualityScore: 70,
      });
      expect(result.tags).toEqual(["industry:fintech", "yc-backed"]);
      expect(result.isVerified).toBe(true);
      expect(result.qualityScore).toBe(70);
      expect(result.shouldOverwriteName).toBe(true);
    });
  });

  describe("updates from same source", () => {
    it("does not inject signal:multi-source", () => {
      const result = reconcileCompany(
        { source: "yc", tags: ["yc-backed"], isVerified: true, qualityScore: 70 },
        { source: "yc", tags: ["yc-backed", "topic:ai"], isVerified: true, qualityScore: 75 }
      );
      expect(result.tags).not.toContain("signal:multi-source");
      expect(result.tags).toContain("topic:ai");
    });

    it("ratchets qualityScore upward without multi-source bonus", () => {
      const result = reconcileCompany(
        { source: "yc", tags: [], isVerified: false, qualityScore: 60 },
        { source: "yc", tags: [], isVerified: false, qualityScore: 80 }
      );
      expect(result.qualityScore).toBe(80);
    });
  });

  describe("updates from a different source", () => {
    it("injects signal:multi-source the first time the source changes", () => {
      const result = reconcileCompany(
        { source: "yc", tags: ["yc-backed"], isVerified: true, qualityScore: 70 },
        { source: "thehub", tags: [], isVerified: true, qualityScore: 50 }
      );
      expect(result.tags).toContain("signal:multi-source");
    });

    it("does not double-inject signal:multi-source", () => {
      const result = reconcileCompany(
        {
          source: "yc",
          tags: ["yc-backed", "signal:multi-source"],
          isVerified: true,
          qualityScore: 70,
        },
        { source: "thehub", tags: [], isVerified: true, qualityScore: 50 }
      );
      const count = result.tags.filter((t) => t === "signal:multi-source").length;
      expect(count).toBe(1);
    });

    it("adds +10 quality bonus on first multi-source crossing, capped at 100", () => {
      const a = reconcileCompany(
        { source: "yc", tags: ["yc-backed"], isVerified: true, qualityScore: 70 },
        { source: "thehub", tags: [], isVerified: false, qualityScore: 50 }
      );
      expect(a.qualityScore).toBe(80); // max(70,50) + 10

      const b = reconcileCompany(
        { source: "yc", tags: ["yc-backed"], isVerified: true, qualityScore: 95 },
        { source: "thehub", tags: [], isVerified: false, qualityScore: 50 }
      );
      expect(b.qualityScore).toBe(100); // max(95,50) + 10 = 105 → cap 100
    });

    it("does not add bonus if signal:multi-source was already present", () => {
      const result = reconcileCompany(
        {
          source: "yc",
          tags: ["yc-backed", "signal:multi-source"],
          isVerified: true,
          qualityScore: 70,
        },
        { source: "thehub", tags: [], isVerified: false, qualityScore: 50 }
      );
      expect(result.qualityScore).toBe(70); // no bonus, no upward score
    });

    it("respects source priority for name overwrite — high replaces low", () => {
      const result = reconcileCompany(
        { source: "gregslist", tags: [], isVerified: false, qualityScore: 30 },
        { source: "yc", tags: [], isVerified: true, qualityScore: 70 }
      );
      expect(result.shouldOverwriteName).toBe(true);
    });

    it("respects source priority for name overwrite — low does not replace high", () => {
      const result = reconcileCompany(
        { source: "yc", tags: [], isVerified: true, qualityScore: 70 },
        { source: "gregslist", tags: [], isVerified: false, qualityScore: 30 }
      );
      expect(result.shouldOverwriteName).toBe(false);
    });
  });

  describe("isVerified ratchet", () => {
    it("once true, stays true even when incoming says false", () => {
      const result = reconcileCompany(
        { source: "yc", tags: [], isVerified: true, qualityScore: 70 },
        { source: "thehub", tags: [], isVerified: false, qualityScore: 50 }
      );
      expect(result.isVerified).toBe(true);
    });

    it("flips to true when existing is false and incoming is true", () => {
      const result = reconcileCompany(
        { source: "gregslist", tags: [], isVerified: false, qualityScore: 30 },
        { source: "yc", tags: [], isVerified: true, qualityScore: 70 }
      );
      expect(result.isVerified).toBe(true);
    });
  });

  describe("null quality scores", () => {
    it("uses incoming when existing is null", () => {
      const result = reconcileCompany(
        { source: "yc", tags: [], isVerified: true, qualityScore: null },
        { source: "yc", tags: [], isVerified: true, qualityScore: 70 }
      );
      expect(result.qualityScore).toBe(70);
    });

    it("uses existing when incoming is null", () => {
      const result = reconcileCompany(
        { source: "yc", tags: [], isVerified: true, qualityScore: 70 },
        { source: "yc", tags: [], isVerified: true, qualityScore: null }
      );
      expect(result.qualityScore).toBe(70);
    });

    it("returns null when both are null", () => {
      const result = reconcileCompany(
        { source: "yc", tags: [], isVerified: false, qualityScore: null },
        { source: "yc", tags: [], isVerified: false, qualityScore: null }
      );
      expect(result.qualityScore).toBe(null);
    });
  });
});
