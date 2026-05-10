# Roadmap: Sparrow

## Current State

Sparrow has moved beyond the original three-phase scaffold. The active product is a Vite React + Vercel Functions + Supabase app with campaign workspaces, Gmail sending, Apollo contact search/reveal, Claude drafting, Exa/Tavily research, and a redesigned Home/Templates/Settings shell.

Historical phase documents under `.planning/phases/` and `.planning/research/` are archived planning notes. Use `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, this roadmap, and ADRs for current truth.

## Shipped Foundation

- Supabase auth and profile persistence.
- Google OAuth + Gmail send grant/reconnect.
- Host-managed Claude generation.
- Shared Company/Contact pool and user-scoped Leads, Custom Contacts, Campaigns, Templates, Emails.
- Campaign-first IA and sidebar.
- Full-screen create campaign wizard.
- Campaign workspace routes.
- Template library with verbatim default and optional AI rewrite.
- Draft generation, review, attachment selection, and Gmail sending.
- Apollo search/reveal flows.
- Exa-first personalization research with Tavily fallback.

## Near-Term Roadmap

1. **Quality hardening**
   - Programmatic form labels.
   - Accessible modal focus trap/restore.
   - Settings and template form resilience.
   - E2E coverage for keyboard and dialog behavior.

2. **Performance and reliability**
   - Verify document parser chunks only load on upload paths.
   - Review vendor/manual chunks.
   - Keep campaign/email cache invalidation predictable after send/generate/delete.

3. **Research freshness**
   - Add manual re-research action for stale or weak company dossiers.
   - Make cache freshness policy explicit in UI or admin tooling.

4. **Drafting UX**
   - Surface fallback/generic-draft state when AI generation degrades.
   - Improve row-level error reporting for bulk generation.
   - Tighten attachment and template affordances.

5. **Data quality**
   - Continue verified company enrichment where ROI is clear.
   - Avoid reopening headcount filtering unless the product strategy changes.

## Deferred

- Reply detection and follow-up automation.
- Scheduled sends.
- Native mobile app.
- Open/click tracking.
- LinkedIn scraping.
- BYO API keys.
- BullMQ/Redis worker architecture.

---
*Last updated: 2026-05-05*
