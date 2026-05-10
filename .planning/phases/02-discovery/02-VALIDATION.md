> ARCHIVE NOTICE: This file is historical planning/research context and may describe superseded architecture or requirements. For current project truth, read `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `docs/adr/`, and `.planning/PROJECT.md` first.

---
phase: 2
slug: discovery
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-21
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (Wave 0 — Plan 02-01, Task 0) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-T0 | 01 | 1 | — | infra | `npx vitest run --reporter=verbose` | Created by task | pending |
| 02-01-T1 | 01 | 1 | DISC-03, DISC-04 | schema | `npx prisma validate && npx prisma generate` | Created by task | pending |
| 02-01-T2 | 01 | 1 | DISC-05, LEAD-02, LEAD-03 | unit | `npx tsx --eval "import { normalizeRegion } from './scripts/_lib/region-map.ts'; ..."` | Created by task | pending |
| 02-02-T1a | 02 | 2 | DISC-01 | unit | `npx tsx --eval "import { ingestYC } from './scripts/ingest-yc.ts'; ..."` | Created by task | pending |
| 02-02-T1b | 02 | 2 | DISC-02 | unit | `npx tsx --eval "import { searchContacts } from './scripts/_lib/apollo-client.ts'; ..."` | Created by task | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Wave 0 is handled by Plan 02-01, Task 0 (first task in first plan):

- [x] `vitest` — installed by 02-01-T0
- [x] `vitest.config.ts` — created by 02-01-T0
- [x] `scripts/__tests__/upsert.test.ts` — stub created by 02-01-T0
- [x] `scripts/__tests__/ingest.test.ts` — stub created by 02-01-T0
- [ ] `prisma/schema.prisma` — created by 02-01-T1 (must exist before schema tests run)

*Wave 0 is embedded as Task 0 in Plan 02-01 — no separate plan needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Apollo credit consumption rate | DISC-02 | Requires live Apollo API key | Run enrichment on 10 contacts, check Apollo dashboard for credit deduction |
| Polling loop runs without memory leak | DISC-05 | Requires long-running process observation | Run polling loop for 30 min, monitor with `node --inspect` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (embedded in 02-01-T0)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
