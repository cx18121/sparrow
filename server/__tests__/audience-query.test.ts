import { describe, expect, it } from "vitest";
import { audienceToPrismaWhere, audienceToSqlPredicates } from "../lib/audience-query.js";
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

// ─────────────────────────────────────────────────────────────
// audienceToSqlPredicates — the raw-SQL counterpart used by the
// random-discovery and audience-pool anti-join queries. These tests
// inspect the Prisma.Sql object's .strings (the SQL fragments) and
// .values (the parameters) since Prisma.Sql doesn't expose a single
// "rendered" string. The shape we care about is "predicate references
// the right column AND the right value/array got passed as a parameter."
// ─────────────────────────────────────────────────────────────

// Tiny helper: a single rendered SQL string for one fragment.
function renderSql(sql: { strings: readonly string[]; values: readonly unknown[] }): string {
  // Interleave string parts with placeholders, then collapse — gives us a
  // single string we can match patterns against without caring about the
  // precise placeholder numbering.
  let out = "";
  for (let i = 0; i < sql.strings.length; i++) {
    out += sql.strings[i];
    if (i < sql.values.length) out += `<param:${typeof sql.values[i]}>`;
  }
  return out;
}

describe("audienceToSqlPredicates", () => {
  it("always emits the isVerified gate", () => {
    const preds = audienceToSqlPredicates(baseAudience);
    expect(preds.length).toBeGreaterThanOrEqual(1);
    expect(renderSql(preds[0] as any)).toContain(`c."isVerified" = true`);
  });

  it("emits a stage equality with the stage as a parameter", () => {
    const preds = audienceToSqlPredicates({ ...baseAudience, stage: ["Series A"] });
    const stagePred = preds.find(p => renderSql(p as any).includes(`c."stage"`));
    expect(stagePred).toBeDefined();
    expect((stagePred as any).values).toContain("Series A");
  });

  it("expands 'Series C+' into an array-ANY predicate", () => {
    const preds = audienceToSqlPredicates({ ...baseAudience, stage: ["Series C+"] });
    const stagePred = preds.find(p => renderSql(p as any).includes(`c."stage" = ANY`));
    expect(stagePred).toBeDefined();
    // Stage values come through as one array parameter.
    const arrayParam = (stagePred as any).values.find((v: unknown) => Array.isArray(v)) as string[] | undefined;
    expect(arrayParam).toContain("Series C+");
    expect(arrayParam).toContain("Series C");
    expect(arrayParam).toContain("Series D");
    expect(arrayParam).not.toContain("Series B");
  });

  it("emits a region IS NOT NULL + != ALL pair for international", () => {
    const preds = audienceToSqlPredicates({ ...baseAudience, region: ["__INTL__"] });
    expect(preds.some(p => renderSql(p as any).includes(`c."region" IS NOT NULL`))).toBe(true);
    expect(preds.some(p => renderSql(p as any).includes(`c."region" != ALL`))).toBe(true);
  });

  it("emits an OR block when multiple regions are selected", () => {
    const preds = audienceToSqlPredicates({ ...baseAudience, region: ["__REMOTE__", "Bay Area"] });
    const orPred = preds.find(p => renderSql(p as any).includes(" OR "));
    expect(orPred).toBeDefined();
  });

  it("emits an isHiring predicate with a boolean parameter", () => {
    const preds = audienceToSqlPredicates({ ...baseAudience, isHiring: true });
    const hiringPred = preds.find(p => renderSql(p as any).includes(`c."isHiring"`));
    expect(hiringPred).toBeDefined();
    expect((hiringPred as any).values).toContain(true);
  });

  it("emits a tag overlap predicate using the GIN-indexed && operator", () => {
    const preds = audienceToSqlPredicates({ ...baseAudience, tags: ["vertical:fintech"] });
    const tagsPred = preds.find(p => renderSql(p as any).includes("c.tags &&"));
    expect(tagsPred).toBeDefined();
    expect((tagsPred as any).values).toEqual(expect.arrayContaining([["vertical:fintech"]]));
  });

  it("buckets multi-namespace tags into separate AND'd predicates", () => {
    const preds = audienceToSqlPredicates({
      ...baseAudience,
      tags: ["vertical:fintech", "stage:Seed"],
    });
    // Two tag predicates, one per namespace.
    const tagPreds = preds.filter(p => renderSql(p as any).includes("c.tags &&"));
    expect(tagPreds).toHaveLength(2);
  });

  it("merges extras.sources as an array-ANY predicate", () => {
    const preds = audienceToSqlPredicates(baseAudience, { sources: ["yc", "a16z"] });
    const sourcePred = preds.find(p => renderSql(p as any).includes(`c."source" = ANY`));
    expect(sourcePred).toBeDefined();
    expect((sourcePred as any).values).toEqual(expect.arrayContaining([["yc", "a16z"]]));
  });

  it("appends search as a case-insensitive prefix match", () => {
    const preds = audienceToSqlPredicates(baseAudience, { search: "Anthrop" });
    const searchPred = preds.find(p => renderSql(p as any).includes(`c."name" ILIKE`));
    expect(searchPred).toBeDefined();
    // The search term is concatenated with '%' inside the JS, then passed
    // as a single parameter — so we see "Anthrop%" as one value.
    expect((searchPred as any).values).toContain("Anthrop%");
  });

  it("emits qualityScore >= predicate from extras.minScore", () => {
    const preds = audienceToSqlPredicates(baseAudience, { minScore: 70 });
    const scorePred = preds.find(p => renderSql(p as any).includes(`c."qualityScore" >=`));
    expect(scorePred).toBeDefined();
    expect((scorePred as any).values).toContain(70);
  });

  it("never references the targetRole field (contact-level concern only)", () => {
    const preds = audienceToSqlPredicates({ ...baseAudience, targetRole: "engineering" as RoleFamily });
    for (const p of preds) {
      expect(renderSql(p as any).toLowerCase()).not.toContain("role");
    }
  });
});
