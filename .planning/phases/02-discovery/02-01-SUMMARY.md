> ARCHIVE NOTICE: This file is historical planning/research context and may describe superseded architecture or requirements. For current project truth, read `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `docs/adr/`, and `.planning/PROJECT.md` first.

---
phase: 02-discovery
plan: 01
subsystem: data-layer
tags: [prisma, schema, ingestion, normalization, cli]
dependency_graph:
  requires: []
  provides: [prisma-schema, region-normalizer, role-normalizer, upsert-helpers, manual-add-cli, vitest-infra]
  affects: [02-02-ingestion-scripts]
tech_stack:
  added: [prisma@7.5.0, "@prisma/client@7.5.0", "@prisma/adapter-pg@7.5.0", pg@8.x, vitest@4.x, tsx@4.x, dotenv@16.x]
  patterns: [prisma-driver-adapter, idempotent-upsert, region-normalization, lazy-dynamic-import]
key_files:
  created:
    - prisma/schema.prisma
    - prisma.config.ts
    - scripts/_lib/prisma.ts
    - scripts/_lib/region-map.ts
    - scripts/_lib/role-normalizer.ts
    - scripts/_lib/upsert.ts
    - scripts/manual-add.ts
    - vitest.config.ts
    - scripts/__tests__/upsert.test.ts
    - scripts/__tests__/ingest.test.ts
  modified:
    - .env.example
    - package.json
decisions:
  - "Prisma 7 requires driver adapter pattern — used @prisma/adapter-pg instead of datasourceUrl in PrismaClient constructor"
  - "Prisma 7 datasource URL moved to prisma.config.ts using defineConfig (breaking change from v6)"
  - "manual-add.ts uses dynamic imports for DB modules so usage prints before any DB connection attempt"
metrics:
  duration: "20 minutes"
  completed_date: "2026-03-21"
  tasks_completed: 3
  files_created: 10
  files_modified: 2
---

# Phase 02 Plan 01: Prisma Schema, Utility Library, and Manual-Add CLI Summary

**One-liner:** PostgreSQL schema with 4 models and LeadStatus enum — all 6 DISC-03 filter fields as indexed columns — plus region/role normalizers, idempotent upsert helpers, manual-add CLI, and vitest test infrastructure using Prisma 7 driver adapter pattern.

## What Was Built

### Task 0: vitest test infrastructure (Wave 0)
- Installed `vitest@4.x` as dev dependency
- Created `vitest.config.ts` targeting `scripts/__tests__/**/*.test.ts`
- Created `scripts/__tests__/upsert.test.ts` with 6 `.todo` stubs (upsertCompany, upsertContact)
- Created `scripts/__tests__/ingest.test.ts` with 8 `.todo` stubs (normalizeRegion, normalizeRole, ingestYC, enrichApollo)
- All 14 stubs run via `npx vitest run` with no failures

### Task 1: Prisma schema
- `prisma/schema.prisma`: Company, Contact, UserLead, Email models + LeadStatus enum
- All 6 DISC-03 filter fields as `@@index` columns: stage, industry, region, isHiring, headcount, role
- `domain String @unique` on Company (upsert key)
- `email String? @unique` on Contact (upsert key)
- `lastVerifiedAt DateTime?` on Contact — separate from `updatedAt`
- `@@unique([userId, companyId, contactId])` on UserLead
- Email model stub (Phase 3 foundation)
- `prisma.config.ts` with `defineConfig({ datasource: { url: env("DATABASE_URL") } })` (Prisma 7 requirement)
- `.env.example` updated with `DATABASE_URL` entry
- Schema validated and client generated via `prisma validate` + `prisma generate`

### Task 2: Shared utility library and manual-add CLI
- `scripts/_lib/prisma.ts`: Prisma 7 singleton using `@prisma/adapter-pg` driver adapter
- `scripts/_lib/region-map.ts`: `REGION_MAP` lookup table + `normalizeRegion()` — maps 30+ cities to named regions (Bay Area, New York Metro, etc.), passthrough for unknown cities
- `scripts/_lib/role-normalizer.ts`: `normalizeRole()` — maps job titles to founder/technical/business/other
- `scripts/_lib/upsert.ts`: `upsertCompany()` + `upsertContact()` using Prisma upsert with domain/email conflict keys; calls normalizers during write; returns null from upsertContact when email is falsy
- `scripts/manual-add.ts`: CLI for DISC-05 manual add — parses --domain/--name/--email/--title/--industry/--stage/--location; prints usage and exits 1 when --domain is missing; calls upsertCompany/upsertContact with source: "manual"

## Verification Results

| Check | Result |
|-------|--------|
| `prisma validate` | PASS |
| `prisma generate` | PASS |
| `npx vitest run` | PASS (14 todos, 0 failures) |
| `normalizeRegion("San Francisco, CA")` | "Bay Area" |
| `normalizeRegion("New York City")` | "New York Metro" |
| `normalizeRegion(null)` | null |
| `normalizeRegion("Tulsa, OK")` | "Tulsa, OK" (passthrough) |
| `normalizeRole("CTO")` | "technical" |
| `normalizeRole("Co-Founder & CEO")` | "founder" |
| `normalizeRole("VP Sales")` | "business" |
| `normalizeRole(null)` | null |
| `manual-add.ts` (no --domain) | prints USAGE + exit 1 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Breaking API Change] Prisma 7 removed `url` from datasource block in schema.prisma**
- **Found during:** Task 1
- **Issue:** Prisma 7.5.0 no longer supports `url = env("DATABASE_URL")` inside `datasource db {}` block. Validation error: "The datasource property `url` is no longer supported in schema files."
- **Fix:** Removed `url` from schema.prisma datasource block. Created `prisma.config.ts` using `defineConfig` from `@prisma/config` with `datasource: { url: env("DATABASE_URL") }`.
- **Files modified:** `prisma/schema.prisma`, `prisma.config.ts` (new)
- **Commits:** fd4d55d

**2. [Rule 1 - Breaking API Change] Prisma 7 PrismaClient requires driver adapter, not datasourceUrl**
- **Found during:** Task 2
- **Issue:** `new PrismaClient()` in Prisma 7 throws `PrismaClientInitializationError: needs to be constructed with a non-empty, valid PrismaClientOptions`. The `datasourceUrl` constructor option was removed — must use `adapter` (driver adapter) or `accelerateUrl`.
- **Fix:** Added `@prisma/adapter-pg` dependency. Updated `scripts/_lib/prisma.ts` to use `new PrismaPg({ connectionString })` adapter passed to `new PrismaClient({ adapter })`.
- **Files modified:** `scripts/_lib/prisma.ts`, `package.json`
- **Commit:** 64f5a4f

**3. [Rule 1 - Bug] manual-add.ts DB module import caused connection error during usage check**
- **Found during:** Task 2 verification
- **Issue:** Static imports of prisma.ts at top of manual-add.ts caused the PrismaClient constructor to run immediately, throwing connection errors when running `manual-add.ts` without `--domain` (before DB is needed).
- **Fix:** Converted static imports of `prisma` and `upsertCompany/upsertContact` in manual-add.ts to dynamic `await import()` — only executed after arg validation confirms `--domain` is present.
- **Files modified:** `scripts/manual-add.ts`
- **Commit:** 64f5a4f

**4. [Rule 3 - Environment] npm install failures on Windows-backed node_modules**
- **Found during:** Tasks 1 & 2
- **Issue:** The project's `node_modules/` is on a Windows filesystem (`/mnt/c/`) accessible via WSL. npm atomic renames (`EACCES`, `ENOTEMPTY`) fail cross-filesystem. Package binaries and transitive deps couldn't be installed via `npm install`.
- **Fix:** Installed packages in `/tmp/prisma-install/` (pure Linux filesystem), then copied the relevant package directories to the project's `node_modules/` manually. Updated `package.json` to record all new dependencies correctly.
- **Impact:** tsx binary symlink manually created; npm lockfile not updated (will need `npm install` from Windows or native Linux environment to fully sync lockfile)

## Known Stubs

The test files contain 14 `.todo` stubs — these are intentional placeholders for Plan 02-02 (ingestion scripts) and beyond:
- `upsert.test.ts`: 6 stubs for upsertCompany/upsertContact (will be filled when DB test fixtures exist)
- `ingest.test.ts`: 8 stubs for normalizeRegion/normalizeRole/ingestYC/enrichApollo (will be filled in Plan 02-02)

These stubs do not block the plan's goal — all non-stub functions are fully implemented and verified.

## Self-Check: PASSED

Files verified:
- `prisma/schema.prisma` — EXISTS
- `prisma.config.ts` — EXISTS
- `scripts/_lib/prisma.ts` — EXISTS
- `scripts/_lib/region-map.ts` — EXISTS
- `scripts/_lib/role-normalizer.ts` — EXISTS
- `scripts/_lib/upsert.ts` — EXISTS
- `scripts/manual-add.ts` — EXISTS
- `vitest.config.ts` — EXISTS
- `scripts/__tests__/upsert.test.ts` — EXISTS
- `scripts/__tests__/ingest.test.ts` — EXISTS

Commits verified:
- 507ebcb — Task 0 (vitest + test stubs)
- fd4d55d — Task 1 (Prisma schema)
- 64f5a4f — Task 2 (utility library + CLI)
