import { describe, it, expect } from "vitest";

describe("upsertCompany", () => {
  it.todo("upserts a company by domain");
  it.todo("is idempotent — running twice produces same state");
  it.todo("calls normalizeRegion on location field");
});

describe("upsertContact", () => {
  it.todo("upserts a contact by email");
  it.todo("returns null when email is falsy");
  it.todo("calls normalizeRole on title field");
});
