import { describe, expect, it } from "vitest";
import { audienceToPrismaWhere } from "../lib/audience-query.js";
import type { RoleFamily } from "../../src/types/roleFamilies.js";

// Pure-function tests for the Audience → Prisma WHERE translator. Doesn't
// need a DB — checks the shape of the where clause for the stage-filter
// expansion specifically.

const baseAudience = {
  tags: [],
  region: [] as string[],
  stage: [] as string[],
  batch: [] as string[],
  isHiring: null as boolean | null,
  // targetRole is a contact-level filter, not a company-pool filter — these
  // tests verify the pool query so it stays null here. See
  // audienceToPrismaWhere implementation: targetRole is intentionally not
  // consumed in the WHERE clause.
  targetRole: null as RoleFamily | null,
};

describe("audienceToPrismaWhere — stage filter", () => {
  it("omits a stage clause when no stage filter is set", () => {
    const where = audienceToPrismaWhere({ ...baseAudience }) as Record<string, unknown>;
    expect(where).not.toHaveProperty("stage");
  });

  it("emits an equality clause for exact-stage filters", () => {
    const where = audienceToPrismaWhere({ ...baseAudience, stage: ["Series A"] }) as Record<string, unknown>;
    expect(where.stage).toBe("Series A");
  });

  it("expands 'Series C+' into an IN clause covering granular ≥C stages", () => {
    const where = audienceToPrismaWhere({ ...baseAudience, stage: ["Series C+"] }) as Record<string, unknown>;
    expect(where.stage).toHaveProperty("in");
    const stageIn = (where.stage as { in: string[] }).in;
    expect(stageIn).toContain("Series C+");
    expect(stageIn).toContain("Series C");
    expect(stageIn).toContain("Series D");
    expect(stageIn).toContain("Series E");
    expect(stageIn).not.toContain("Series B");
    expect(stageIn).not.toContain("Seed");
  });

  it("unions the expansion across multiple selected stages", () => {
    const where = audienceToPrismaWhere({ ...baseAudience, stage: ["Seed", "Series A"] }) as Record<string, unknown>;
    expect(where.stage).toHaveProperty("in");
    const stageIn = (where.stage as { in: string[] }).in;
    expect(stageIn).toContain("Seed");
    expect(stageIn).toContain("Series A");
    expect(stageIn).not.toContain("Series B");
  });

  it("keeps the verified gate regardless of stage filter", () => {
    const where = audienceToPrismaWhere({ ...baseAudience, stage: ["Series C+"] }) as Record<string, unknown>;
    expect(where.isVerified).toBe(true);
  });
});

describe("audienceToPrismaWhere — multi-select region/batch", () => {
  it("emits a single region equality when only one region is selected", () => {
    const where = audienceToPrismaWhere({ ...baseAudience, region: ["Remote"] }) as Record<string, unknown>;
    expect(where.region).toBe("Remote");
  });

  it("emits an OR clause inside AND when multiple regions are selected", () => {
    const where = audienceToPrismaWhere({
      ...baseAudience,
      region: ["__REMOTE__", "Bay Area"],
    }) as Record<string, unknown>;
    expect(where).not.toHaveProperty("region");
    const and = where.AND as Array<Record<string, unknown>>;
    const orClause = and.find(c => "OR" in c) as { OR: Array<Record<string, unknown>> } | undefined;
    expect(orClause).toBeDefined();
    expect(orClause!.OR).toEqual([
      { region: "Remote" },
      { region: "Bay Area" },
    ]);
  });

  it("emits a batch equality when one batch is selected", () => {
    const where = audienceToPrismaWhere({ ...baseAudience, batch: ["W26"] }) as Record<string, unknown>;
    expect(where.batch).toBe("W26");
  });

  it("emits an IN clause when multiple batches are selected", () => {
    const where = audienceToPrismaWhere({ ...baseAudience, batch: ["W26", "S25"] }) as Record<string, unknown>;
    expect(where.batch).toEqual({ in: ["W26", "S25"] });
  });
});
