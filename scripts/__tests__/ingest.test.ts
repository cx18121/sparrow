import { describe, it, expect } from "vitest";
import { normalizeRegion } from "../_lib/region-map.js";
import { normalizeRole } from "../_lib/role-normalizer.js";

describe("normalizeRegion", () => {
  it("maps 'San Francisco' to 'Bay Area'", () => {
    expect(normalizeRegion("San Francisco")).toBe("Bay Area");
  });

  it("maps full YC-style location string to Bay Area", () => {
    expect(normalizeRegion("San Francisco, CA, USA")).toBe("Bay Area");
  });

  it("maps 'New York' to 'New York Metro'", () => {
    expect(normalizeRegion("New York")).toBe("New York Metro");
  });

  it("maps 'New York City, NY' to 'New York Metro'", () => {
    expect(normalizeRegion("New York City, NY")).toBe("New York Metro");
  });

  it("is case-insensitive", () => {
    expect(normalizeRegion("SAN FRANCISCO")).toBe("Bay Area");
    expect(normalizeRegion("new york")).toBe("New York Metro");
  });

  it("returns null for null input", () => {
    expect(normalizeRegion(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeRegion("")).toBeNull();
  });

  it("passes through unknown cities unchanged", () => {
    expect(normalizeRegion("Tulsa, OK")).toBe("Tulsa, OK");
  });

  it("maps 'Remote' to 'Remote'", () => {
    expect(normalizeRegion("Remote")).toBe("Remote");
  });
});

describe("normalizeRole", () => {
  it("maps 'CTO' to 'technical'", () => {
    expect(normalizeRole("CTO")).toBe("technical");
  });

  it("maps 'Co-Founder' to 'founder'", () => {
    expect(normalizeRole("Co-Founder")).toBe("founder");
  });

  it("returns null for null input", () => {
    expect(normalizeRole(null)).toBeNull();
  });

  it("maps 'CEO' to 'founder'", () => {
    expect(normalizeRole("CEO")).toBe("founder");
  });

  it("maps 'Software Engineer' to 'technical'", () => {
    expect(normalizeRole("Software Engineer")).toBe("technical");
  });

  it("maps 'VP of Sales' to 'business'", () => {
    expect(normalizeRole("VP of Sales")).toBe("business");
  });

  it("maps unrecognized title to 'other'", () => {
    expect(normalizeRole("Office Manager")).toBe("other");
  });
});

describe("ingestYC", () => {
  it("exports ingestYC as a function", async () => {
    const mod = await import("../ingest-yc.js");
    expect(typeof mod.ingestYC).toBe("function");
  });
});

describe("enrichApollo", () => {
  it("exports enrichApollo as a function", async () => {
    const mod = await import("../enrich-apollo.js");
    expect(typeof mod.enrichApollo).toBe("function");
  });
});
