import { describe, it, expect } from "vitest";
import { normalizeRegion } from "../_lib/region-map.js";

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
  it.todo("maps 'CTO' to 'technical'");
  it.todo("maps 'Co-Founder' to 'founder'");
  it.todo("returns null for null input");
});

describe("ingestYC", () => {
  it.todo("exports ingestYC as a function");
});

describe("enrichApollo", () => {
  it.todo("exports enrichApollo as a function");
});
