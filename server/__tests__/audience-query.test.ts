import { describe, expect, it } from "vitest";
import { audienceToPrismaWhere } from "../lib/audience-query.js";
import type { RoleFamily } from "../../src/types/roleFamilies.js";

// Pure-function tests for the Audience → Prisma WHERE translator. Doesn't
// need a DB — checks the shape of the where clause for the stage-filter
// expansion specifically.

const baseAudience = {
  tags: [],
  region: null as string | null,
  stage: null as string | null,
  batch: null as string | null,
  isHiring: null as boolean | null,
  // targetRoles is a contact-level filter, not a company-pool filter — these
  // tests verify the pool query so it stays empty here. See
  // audienceToPrismaWhere implementation: targetRoles is intentionally not
  // consumed in the WHERE clause.
  targetRoles: [] as RoleFamily[],
};

describe("audienceToPrismaWhere — stage filter", () => {
  it("omits a stage clause when no stage filter is set", () => {
    const where = audienceToPrismaWhere({ ...baseAudience }) as Record<string, unknown>;
    expect(where).not.toHaveProperty("stage");
  });

  it("emits an equality clause for exact-stage filters", () => {
    const where = audienceToPrismaWhere({ ...baseAudience, stage: "Series A" }) as Record<string, unknown>;
    expect(where.stage).toBe("Series A");
  });

  it("expands 'Series C+' into an IN clause covering granular ≥C stages", () => {
    const where = audienceToPrismaWhere({ ...baseAudience, stage: "Series C+" }) as Record<string, unknown>;
    expect(where.stage).toHaveProperty("in");
    const stageIn = (where.stage as { in: string[] }).in;
    expect(stageIn).toContain("Series C+");
    expect(stageIn).toContain("Series C");
    expect(stageIn).toContain("Series D");
    expect(stageIn).toContain("Series E");
    expect(stageIn).not.toContain("Series B");
    expect(stageIn).not.toContain("Seed");
  });

  it("keeps the verified gate regardless of stage filter", () => {
    const where = audienceToPrismaWhere({ ...baseAudience, stage: "Series C+" }) as Record<string, unknown>;
    expect(where.isVerified).toBe(true);
  });
});
