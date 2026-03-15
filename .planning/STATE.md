# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-15)

**Core value:** Automate startup discovery, contact enrichment, and personalized email generation end-to-end — so users focus on relationships, not research.
**Current focus:** Phase 1 — Foundation

## Current Position

Phase: 1 of 3 (Foundation)
Plan: 0 of 2 in current phase
Status: Ready to plan
Last activity: 2026-03-15 — Roadmap created

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Architecture: BullMQ workers CANNOT run on Vercel — worker process must deploy on Railway/Fly.io
- Architecture: Supabase RLS must be enabled on all tables before any data is written (Phase 1 prerequisite)
- Architecture: Gmail OAuth2 only (basic SMTP auth deprecated May 2025) — use `googleapis` + Nodemailer
- Data model: Shared global company/contact pool (no userId); per-user data always userId-scoped
- Auth: Google OAuth serves dual purpose — account auth AND Gmail sending authorization

### Pending Todos

None yet.

### Blockers/Concerns

- Wellfound scraping feasibility unknown — anti-bot protections may require `playwright-extra` stealth or proxy rotation. Spike before committing to implementation in Phase 2.
- Apollo API tier: free tier (600 credits/month) likely insufficient. Cost model for per-user Apollo key storage needs validation before Phase 2 planning.
- Gmail push notifications (Pub/Sub) vs IMAP polling tradeoff unresolved — evaluate during Phase 3 planning before building reply detection.

## Session Continuity

Last session: 2026-03-15
Stopped at: Roadmap created — all 28 v1 requirements mapped to 3 phases. Ready to plan Phase 1.
Resume file: None
