# Random company discovery via DB anti-join with ORDER BY random()

Status: Accepted 2026-05-22.

`/api/companies?random=1` selects N unseen companies matching the user's audience filter, for the Leads tab's random-discovery UI. "Unseen" means the company is not in the user's `DiscoverySeenCompany` table (browsed without saving) and not in their `UserLead` table (already saved).

The pre-rewrite implementation (everything before commit `13fa316`) was a JS-side filter:

1. Run a Prisma `findMany` against `Company` with the audience filter, returning every matching candidate.
2. Fetch the user's full `DiscoverySeenCompany.companyId` set and `UserLead.companyId` set.
3. Subtract those sets from the candidates in JS.
4. `Math.random()` shuffle the remainder.
5. Slice the first N.

This had a worsening tax that scaled with two things: total `Company` row count (the matched candidate set could be tens of thousands) and user engagement (the seen-set grew without bound). The realistic worst case as of the 2026-05-22 DB expansion is fetching ~30k+ candidate rows from the wire, subtracting a few thousand seen IDs in JS, and throwing 99.9% away. Prisma can't express `WHERE NOT IN (...)` against a sibling table without round-tripping the IDs.

This ADR commits to:

**1. One round-trip raw SQL with two `NOT EXISTS` anti-joins.** `selectRandomDiscoveryCompanies` in `server/routes/companies.ts` builds a single query of the shape:

```sql
SELECT c.* FROM "Company" c
WHERE <audience predicates>
  AND NOT EXISTS (
    SELECT 1 FROM "DiscoverySeenCompany" d WHERE d."companyId" = c.id AND d."userId" = $userId
  )
  AND NOT EXISTS (
    SELECT 1 FROM "UserLead" u WHERE u."companyId" = c.id AND u."userId" = $userId
  )
ORDER BY random()
LIMIT $take
```

Postgres runs `ORDER BY random() + LIMIT N` as a top-N selection inside the database — it does NOT sort the full matched set. The FK indexes mirrored in migration `20260522233500_company_fk_indexes_and_autovacuum` make the two anti-joins index-only.

**2. Audience predicates are built by `audienceToSqlPredicates`** (`server/lib/audience-query.ts`), the SQL-flavored twin of `audienceToPrismaWhere`. Both share the same logical predicate set; the audience-sql parity test pins them in sync. The twin builder exists specifically because raw SQL can't go through Prisma's typed query builder without losing the ability to compose with the `NOT EXISTS` arms.

**3. Empty-result fallback.** If the anti-join returns 0 (the user has seen everything that matches their filter — common for narrow audiences), the route re-runs the same query without the anti-joins and flags `usingFallback: true`. The frontend banner uses this signal to hint "showing companies you've seen before."

**4. `take` is clamped to `[1, 200]` before raw interpolation.** `LIMIT ${take}` is the only piece of user-influenced input that ends up interpolated into the raw SQL (everything else goes through `Prisma.sql` parameter binding). Without the clamp, an unbounded `take` would let a malformed request inject arbitrary SQL fragments. Commit `969069a` added the clamp; this ADR records that it is **load-bearing security**, not just a perf knob.

**5. `audience-pool.ts` shares the anti-join pattern** for the related campaign-batch random-selection path. The shared helper means both routes pick from the same "unseen company" model; the audience-sql twin builder serves both.

## Consequences

**Raw SQL is introduced into a route layer that otherwise uses Prisma's typed query builder.** Future contributors will look at `selectRandomDiscoveryCompanies` and reach for "clean this up to typed Prisma" — this ADR is the answer to that impulse. The wins (one round-trip vs many, in-DB random vs wire-transfer-then-shuffle) only materialize because the query is raw; converting it to typed Prisma would require either round-tripping IDs again or building a Prisma extension that emits the same SQL, neither of which is worth the typed-builder gain at this scale.

**`audience-query.ts` carries two builders that must stay in sync.** The audience-sql parity test catches today's known failure mode (a Prisma predicate landing without an SQL twin) but doesn't catch novel predicate shapes added in either direction. The longer-term refactor — a single predicate AST with `toPrisma()` and `toSql()` renderers — is sketched in `.scratch/audit-arch.md` as a future improvement; not part of this ADR.

**The clamp is enforced at one site.** If a third caller adopts raw `LIMIT` interpolation, that caller must re-implement the clamp. Worth grepping for `Prisma.sql\`...LIMIT \${` before adding new raw-SQL paths.

**Snapshot-table coupling.** This ADR and ADR-0006 ship together. `/api/campaign-options` reads from the snapshot table; `/api/companies?random=1` runs against the live `Company` table. The two paths share an audience-filter contract (`audienceToPrismaWhere` / `audienceToSqlPredicates`) but otherwise have different staleness characteristics — campaign-options can be stale-vs-the-snapshot-refresh; random discovery is always live.
