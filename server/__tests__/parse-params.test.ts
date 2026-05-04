import { describe, expect, it } from "vitest";
import { parseBody, parseNullableBoolean, parseNullableNumber, parsePageSize } from "../lib/parse-params.js";
import { HttpError } from "../lib/user.js";

describe("parseNullableNumber", () => {
  it("returns null for absent or empty values", () => {
    expect(parseNullableNumber(undefined)).toBeNull();
    expect(parseNullableNumber(null)).toBeNull();
    expect(parseNullableNumber("")).toBeNull();
  });

  it("parses finite numeric values", () => {
    expect(parseNullableNumber("42")).toBe(42);
    expect(parseNullableNumber(3.5)).toBe(3.5);
  });

  it("rejects non-numeric values", () => {
    expect(() => parseNullableNumber("many")).toThrow(new HttpError(400, "Invalid numeric value"));
  });
});

describe("parsePageSize", () => {
  it("defaults missing or invalid values to 50", () => {
    expect(parsePageSize(undefined)).toBe(50);
    expect(parsePageSize("")).toBe(50);
    expect(parsePageSize("many")).toBe(50);
  });

  it("clamps finite values to the supported route pagination range", () => {
    expect(parsePageSize("-3")).toBe(1);
    expect(parsePageSize("25")).toBe(25);
    expect(parsePageSize("500")).toBe(200);
  });
});

describe("parseNullableBoolean", () => {
  it("returns null for absent or empty values", () => {
    expect(parseNullableBoolean(undefined)).toBeNull();
    expect(parseNullableBoolean(null)).toBeNull();
    expect(parseNullableBoolean("")).toBeNull();
  });

  it("accepts booleans and boolean strings", () => {
    expect(parseNullableBoolean(true)).toBe(true);
    expect(parseNullableBoolean(false)).toBe(false);
    expect(parseNullableBoolean("true")).toBe(true);
    expect(parseNullableBoolean("false")).toBe(false);
  });

  it("rejects other values", () => {
    expect(() => parseNullableBoolean("yes")).toThrow(new HttpError(400, "Invalid boolean value"));
  });
});

describe("parseBody", () => {
  it("returns null for empty bodies", () => {
    expect(parseBody({})).toBeNull();
    expect(parseBody({ body: null })).toBeNull();
  });

  it("parses JSON string bodies", () => {
    expect(parseBody({ body: '{"name":"Jane"}' })).toEqual({ name: "Jane" });
  });

  it("throws a typed 400 error for malformed JSON string bodies", () => {
    expect(() => parseBody({ body: "{" })).toThrow(new HttpError(400, "Invalid JSON body"));
  });

  it("returns object bodies as-is", () => {
    const body = { name: "Jane" };
    expect(parseBody({ body })).toBe(body);
  });
});
