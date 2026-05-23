# Back /api/campaign-options with a precomputed snapshot table

Status: Accepted 2026-05-22.

The wizard's filter-chip endpoint (`/api/campaign-options`) returns the union of distinct values needed to populate every filter row: industries, regions, stages, batches, sources, plus per-namespace tag facets (`vertical:*`, `tech:*`, `signal:*`, `investor:*`, `model:*`). The data is **global** — every authed user gets the same payload — but the 10 underlying aggregations (5 `DISTINCT` scans + 1 `unnest(tags) GROUP BY` + 4 counts) cost ~40s of tail latency cold-cache against a 30k+ row `Company` table. A naive request burst (e.g. several users opening the wizard within a minute on a cold Vercel function) would multiply this cost across instances.

An earlier attempt at fixing this was an in-process LRU cache with 60s TTL and single-flight (commit `daff053`). That hid the cost per warm instance but did nothing for the cross-instance miss storm risk — each cold function spin-up still paid the full aggregation cost.

This ADR commits to a different approach: **materialize the entire response into a singleton row and serve a single-row PK lookup.**

**1. The snapshot table.** Migration `20260523001500_company_options_snapshot` creates `CompanyOptionsSnapshot` with a fixed `id = 1` row whose `payload` JSONB column holds the full `CompanyOptionsPayload` shape (`server/lib/company-options.ts`). `/api/campaign-options` (`server/routes/campaign-options.ts`) does `readCompanyOptionsSnapshot()` — a single indexed PK read.

**2. Refresh is manual.** `scripts/refresh-company-options.ts` runs the expensive aggregation (`computeCompanyOptionsPayload`) and writes the new payload via `refreshCompanyOptionsSnapshot()`. Refresh takes ~1–5s against the live DB. The script must be re-run after every ingest session, otherwise newly-ingested sources or new tags won't appear in the wizard chip palette.

**3. Cold-start fallback.** If the snapshot row is missing (fresh prod deploy with no manual refresh yet, or a manually-dropped row), `/api/campaign-options` falls through to `refreshCompanyOptionsSnapshot()` on the first request, writes the row, and serves the result. Subsequent requests get the cheap path. This means a fresh deploy doesn't error — it pays one expensive request, then is cheap forever.

**4. The in-process LRU is removed.** `daff053`'s cache (and its single-flight machinery) is gone — no LRU imports remain in either `campaign-options.ts` or `company-options.ts`. A snapshot read is already ~1ms; an additional in-memory layer would be solving a problem that no longer exists.

## Consequences

**Wizard filter chips can lag the underlying `Company` table** until `refresh-company-options.ts` is re-run. Operator responsibility — the script doesn't run automatically post-ingest. CLAUDE.md's "Audience filter" section names this so new contributors discover the contract before adding a new ingest adapter. The trade-off is acceptable because ingest is operator-run, not user-triggered; the delay between adding a source and the chips updating is bounded by how often the operator chooses to refresh, not by any user-facing flow.

**Fresh-deploy first-request is slow** (~1–5s) and writes to the DB on the read path. This is documented in `refreshCompanyOptionsSnapshot()`'s comments. The alternative — failing the request and pointing at the refresh script — was rejected because it makes the local-dev experience materially worse for a contributor who has just `npm run db:push:local`'d a fresh schema. The auto-bootstrap is forgiving.

**Future refresh automation** is intentionally not part of this ADR. A post-ingest hook in `runIngestor` that calls `refreshCompanyOptionsSnapshot()` is one obvious next step; a scheduled refresh (cron) is another. Both are reversible and don't change the contract this ADR codifies (snapshot row is the source of truth for the endpoint).

**The 200-row clamp** added in commit `969069a` to `/api/companies` (`take` clamped to `[1, 200]` before raw `LIMIT ${take}` interpolation) is unrelated to this endpoint but is a sibling perf-sprint decision that ADR-0008 records — they ship together because both close holes that the original "everything goes through Prisma's findMany" approach had.
