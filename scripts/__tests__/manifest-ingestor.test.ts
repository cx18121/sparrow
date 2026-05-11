import { describe, expect, it, vi } from "vitest";
import * as cheerio from "cheerio";

// manifest-ingestor pulls in runIngestor → upsert → prisma, which throws at
// module-init time if DATABASE_URL is missing. Mock prisma so the pure
// extractor helpers can be exercised without a DB.
vi.mock("../_lib/prisma.js", () => ({ prisma: {} }));

import { _internal } from "../_lib/manifest-ingestor.js";

const { readPath, readWpExtractor, extractFromHtml, rejectedByHost, shouldSkipWpRest, shouldSkipHtml } = _internal;

describe("manifest-ingestor extractors", () => {
  describe("readPath", () => {
    it("walks dot-paths", () => {
      expect(readPath({ a: { b: { c: 1 } } }, "a.b.c")).toBe(1);
    });
    it("returns null on missing key", () => {
      expect(readPath({ a: {} }, "a.b.c")).toBeNull();
    });
    it("returns null on null root", () => {
      expect(readPath(null, "a.b")).toBeNull();
    });
    it("handles array indices via numeric segments", () => {
      expect(readPath({ xs: [{ k: "v" }] }, "xs.0.k")).toBe("v");
    });
  });

  describe("rejectedByHost", () => {
    it("matches exact host", () => {
      expect(rejectedByHost("https://pear.vc/post", ["pear.vc"])).toBe(true);
    });
    it("matches subdomain via dot-prefix rule", () => {
      expect(rejectedByHost("https://www.pear.vc/post", ["pear.vc"])).toBe(true);
    });
    it("does not match unrelated hosts", () => {
      expect(rejectedByHost("https://gravisrobotics.com", ["pear.vc"])).toBe(false);
    });
    it("returns false on non-URL value", () => {
      expect(rejectedByHost("not a url", ["pear.vc"])).toBe(false);
    });
    it("returns false when no rejectHosts", () => {
      expect(rejectedByHost("https://pear.vc", undefined)).toBe(false);
    });
  });

  describe("readWpExtractor", () => {
    const record = {
      title: { rendered: "Gravis Robotics" },
      link: "https://www.gravisrobotics.com/",
      meta: { website_url: "https://override.example/" },
    };

    it("supports string-path extractor", () => {
      expect(readWpExtractor(record, "title.rendered")).toBe("Gravis Robotics");
    });

    it("returns null when the path is missing", () => {
      expect(readWpExtractor(record, "title.missing")).toBeNull();
    });

    it("supports array-of-paths fallback", () => {
      expect(readWpExtractor({ a: "", b: "yes" }, ["a", "b"])).toBe("yes");
    });

    it("walks paths and rejects self-host URLs", () => {
      const blogPost = { link: "https://pear.vc/announcement", meta: { website_url: "https://piston.example/" } };
      expect(
        readWpExtractor(blogPost, { paths: ["link", "meta.website_url"], rejectHosts: ["pear.vc"] })
      ).toBe("https://piston.example/");
    });

    it("returns null if every path is rejected or empty", () => {
      const allBad = { link: "https://pear.vc/x", meta: {} };
      expect(
        readWpExtractor(allBad, { paths: ["link", "meta.website_url"], rejectHosts: ["pear.vc"] })
      ).toBeNull();
    });
  });

  describe("shouldSkipWpRest", () => {
    it("skips when a single-value path matches a value", () => {
      const r = { company_group: "acquired" };
      expect(shouldSkipWpRest(r, [{ path: "company_group", values: ["acquired", "ipo"] }])).toBe(true);
    });
    it("does substring-style matching (lowercased)", () => {
      const r = { status: "Exited (IPO)" };
      expect(shouldSkipWpRest(r, [{ path: "status", values: ["ipo"] }])).toBe(true);
    });
    it("scans array values", () => {
      const r = { tags: ["active", "growth"] };
      expect(shouldSkipWpRest(r, [{ path: "tags", values: ["growth"] }])).toBe(true);
    });
    it("returns false when no rule applies", () => {
      expect(shouldSkipWpRest({ status: "Active" }, [{ path: "status", values: ["dead"] }])).toBe(false);
    });
  });

  describe("HTML extractors", () => {
    const html = `
      <ul>
        <li class="card">
          <a href="https://carboculture.com/" target="_blank">
            <img alt="carbo culture" src="logo.png" />
          </a>
          <span class="status">Active</span>
        </li>
        <li class="card">
          <a href="https://example.com/" target="_blank">
            <img alt="Acme" src="logo2.png" />
          </a>
          <span class="status">Acquired by BigCo</span>
        </li>
      </ul>
    `;

    it("extracts text from element textContent (attr default)", () => {
      const $ = cheerio.load(html);
      const $el = $(".card").first();
      expect(extractFromHtml($el, $, { selector: ".status" })).toBe("Active");
    });

    it("extracts attribute values", () => {
      const $ = cheerio.load(html);
      const $el = $(".card").first();
      expect(extractFromHtml($el, $, { selector: "img", attr: "alt" })).toBe("carbo culture");
      expect(extractFromHtml($el, $, { selector: "a", attr: "href" })).toBe("https://carboculture.com/");
    });

    it("returns null when selector doesn't match", () => {
      const $ = cheerio.load(html);
      const $el = $(".card").first();
      expect(extractFromHtml($el, $, { selector: ".nope" })).toBeNull();
    });

    it("skip rule matches by contains text", () => {
      const $ = cheerio.load(html);
      const $first = $(".card").eq(0);
      const $second = $(".card").eq(1);
      const rule = [{ selector: ".status", contains: ["acquired", "ipo"] }];
      expect(shouldSkipHtml($first, $, rule)).toBe(false);
      expect(shouldSkipHtml($second, $, rule)).toBe(true);
    });

    it("skip rule with no contains skips on any match", () => {
      const $ = cheerio.load(html);
      const $el = $(".card").first();
      expect(shouldSkipHtml($el, $, [{ selector: ".status" }])).toBe(true);
      expect(shouldSkipHtml($el, $, [{ selector: ".nope" }])).toBe(false);
    });
  });
});
