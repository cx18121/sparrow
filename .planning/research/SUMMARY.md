> ARCHIVE NOTICE: This file is historical planning/research context and may describe superseded architecture or requirements. For current project truth, read `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `docs/adr/`, and `.planning/PROJECT.md` first.

# Project Research Summary

**Project:** Cold Email Automation SaaS
**Domain:** Cold email outreach for students, internship seekers, and collaborator seekers targeting early-stage startups
**Researched:** 2026-03-15
**Confidence:** MEDIUM-HIGH

---

## Executive Summary

This is a niche cold email outreach SaaS targeting students and collaborator seekers — not B2B sales reps. The key differentiator is startup-specific lead discovery (YC, Product Hunt, The Hub, startups.gallery, Gregslist, HN Hiring, and VC portfolio scrapers) combined with resume-driven, tone-matched AI email generation via Claude. Competitors like Lemlist, Instantly, and Apollo target enterprise sales teams and do not address the student/early-career use case. The product fills a real gap: no tool today ingests a user's resume as a personalization substrate, filters by startup hiring status and funding stage, or produces non-salesy outreach appropriate for internship or co-founder outreach.

The recommended architecture is a Next.js 15 App Router frontend deployed on Vercel, backed by a Supabase PostgreSQL database via Prisma, with a separate long-running BullMQ worker process deployed on Railway or Fly.io. This split is non-negotiable — BullMQ workers cannot run on Vercel serverless. All scraping, email sending, reply detection, and AI generation at batch scale must run in the worker process. The API routes are thin orchestrators that enqueue jobs and return immediately. A shared global company/contact pool with strict per-user data isolation (via userId-scoped tables) is the core data model — it reduces Apollo API credit consumption by sharing enriched contact data across users.

The top risks are deliverability (cold domains get flagged immediately without warmup enforcement), data leakage (Supabase RLS must be enabled on every table before first INSERT), and job idempotency (BullMQ retries can duplicate emails if not defended against). None of these are exotic problems — all have well-documented solutions that must be built in from the start rather than retrofitted. The legal risks (CAN-SPAM, GDPR) are real: a non-functional unsubscribe link or missing suppression list is not a UX oversight, it is a compliance failure that cannot ship.

---

## Key Findings

### Recommended Stack

The stack is largely mandated by the project brief and aligns well with current best practices. Next.js 15 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui provides the full-stack foundation. Supabase (PostgreSQL + Auth) replaces the need for a separate auth layer — its native RLS integration is especially valuable for the multi-user data isolation model. Prisma 5 (with a migration path to Prisma 7's pure TypeScript client) handles the ORM layer with strong codegen type safety.

The background processing stack requires careful deployment planning. BullMQ 5 backed by Upstash Redis (serverless-compatible) is the right choice, but the workers must run on Railway or Fly.io as a persistent Node.js process. Vercel cannot host them. The Gmail stack uses `googleapis` (not raw Nodemailer SMTP) to handle OAuth2 token lifecycle and enable reply detection. Google deprecated basic SMTP auth in May 2025 — OAuth 2.0 is mandatory. Claude API (`@anthropic-ai/sdk`) handles email generation; per-user API key storage (encrypted) ensures cost isolation.

**Core technologies:**
- **Next.js 15 (App Router):** Full-stack framework — server components, API routes, server actions
- **TypeScript 5:** Non-negotiable with Prisma codegen, Zod, and Claude SDK all providing first-class types
- **Tailwind CSS 4 + shadcn/ui (canary):** Accessible component primitives; canary channel required for Tailwind v4 support
- **Supabase (PostgreSQL + Auth):** Managed Postgres with native RLS; eliminates separate auth layer; free to 50K MAU
- **Prisma 5:** ORM + migrations; use session pooler (port 5432) for app, direct connection for migrations
- **BullMQ 5 + Upstash Redis:** Background job queue; workers MUST run outside Vercel (Railway/Fly.io)
- **`@anthropic-ai/sdk`:** Claude API for email generation; requires Node.js 20+
- **`googleapis` + Nodemailer:** Gmail OAuth2 send + IMAP reply detection; basic SMTP auth is deprecated
- **Playwright + Cheerio:** Browser-based scraping for SPAs (YC); Cheerio for static HTML fallback
- **Zod + react-hook-form:** Form validation and env var schema enforcement throughout

**Critical version requirement:** Prisma with Supabase must use the session-mode connection string (port 5432), not the transaction pooler (port 6543) — prepared statements break on the transaction pooler.

### Expected Features

The MVP (v1) is well-defined based on feature dependency analysis. The non-negotiable core flow is: user onboards with resume + Gmail → discovers YC/Product Hunt leads → generates AI email → reviews and sends → tracks status and follow-ups. Everything else builds on this loop.

**Must have (table stakes — v1):**
- User account (signup/login via Supabase Auth with Google OAuth)
- Onboarding wizard: sender info, Gmail OAuth, resume upload, email template — 5-minute activation target
- Resume/bio upload and parsing (PDF or paste) — the primary AI personalization input
- Lead discovery from YC + Product Hunt (minimum v1 sources)
- Lead dashboard with filters: industry, funding stage, location, is-hiring
- AI email generation via Claude using resume + template + company context
- Email preview before send — human-in-the-loop is mandatory; no auto-send
- Direct send via Gmail OAuth from user's own account
- Per-lead status tracking (manual: New/Contacted/Replied/Interested/Rejected)
- Sent email history log
- Follow-up reminders (time-based, N days after send with no reply)
- Unsubscribe/opt-out handling with functional suppression list (CAN-SPAM/GDPR prerequisite)
- Basic daily send caps (20-30/day for new accounts) enforced at job level

**Should have (add after core is stable — v1.x):**
- Reply auto-detection via Gmail API polling
- Product Hunt as an additional discovery source
- Follow-up email AI generation (not just reminders — generate the follow-up draft)
- Region grouping for location filters (e.g., "Bay Area" = SF + San Jose + Oakland)
- Agentic company context gathering (live web search per company before generation)
- Collaborator/co-founder mode (different tone targets, different role filters)

**Defer (v2+):**
- A/B testing email variants (needs statistical volume students don't generate)
- Kanban pipeline view (simple status column is sufficient for MVP)
- Batch send queue with approval flow (single-send with review is safer)
- Apollo as additional enrichment source (adds cost; YC + PH sufficient to validate)
- Email warm-up integration (link to external tools; do not build)
- LinkedIn scraping or outreach (legal risk, ToS violation — never build)

### Architecture Approach

The architecture follows a clean four-layer pattern: Next.js presentation + API routes (thin) → Service layer (business logic, shared by API routes and workers) → BullMQ worker process (all async operations) → Data layer (Supabase/Prisma + Upstash Redis). The defining structural decision is the Vercel/Railway deployment split: the Next.js app lives on Vercel; the worker process lives on Railway. They communicate exclusively through Redis (BullMQ queues) and share the same Supabase Postgres database.

The data model is built around a shared global company/contact pool with strict per-user overlays. Companies and contacts have no `userId` — they are shared across all users and upserted by domain/email. Per-user data (`user_leads`, `emails`, preferences, API keys) always carries a `userId` foreign key and is isolated via Prisma `where: { userId }` filters on every query. This model reduces Apollo API credit burn significantly and is the right architecture for a multi-user product.

**Major components:**
1. **Next.js App (Vercel)** — routing, SSR, thin API route handlers, auth middleware, onboarding wizard
2. **Service Layer (`src/services/`)** — pure TypeScript business logic (LeadService, EmailService, AIService, EnrichmentService, ReplyService); called by both API routes and workers
3. **BullMQ Worker Process (Railway/Fly.io)** — three queues: `scrape-queue` (YC/PH/VC portfolios), `email-queue` (send via Gmail), `reply-queue` (IMAP polling, repeatable); shares services and DB with the Next.js app
4. **Prisma ORM + Supabase Postgres** — schema management, shared global tables + per-user tables, connection pooling via Supabase PgBouncer
5. **Upstash Redis** — BullMQ backing store, job state, rate-limit counters; serverless-compatible, accessible from both Vercel and Railway
6. **External APIs** — Claude API (per-user key), Apollo API (per-user key), Gmail API (per-user OAuth2 token), YC/Product Hunt/VC portfolio scrapers

### Critical Pitfalls

10 pitfalls identified. The top 5 that must be addressed before or during the phases that introduce them:

1. **Cold domain with no warmup** — enforce daily send caps (20-30/day for new accounts) at the BullMQ job level, not just in the UI. Show sending readiness indicator in onboarding. Recovery from damaged domain reputation takes weeks and may be permanent. Address in: Email Sending phase.

2. **Supabase RLS misconfiguration leaking cross-user data** — enable RLS on every table before the first INSERT. Write tests asserting user A cannot read user B's emails, notes, or API keys. The service role bypasses all RLS — never use it in client-facing code. Address in: Auth/Foundation phase (day one).

3. **BullMQ jobs not idempotent → duplicate emails sent** — use deterministic job IDs (e.g., `email-gen-{userId}-{contactId}`), store job state in the database before processing, add unique constraint on `user_id + contact_id` in the emails table. Address in: Background Jobs phase (before email sending is connected).

4. **Gmail OAuth scope too broad + token refresh failures** — request minimum scopes (`gmail.send` + `gmail.readonly`); store refresh tokens encrypted in DB; implement token health checks that surface disconnected state in the user dashboard within 15 minutes. Address in: Gmail Integration phase.

5. **AI-generated emails sound identical across all users** — structural variation must be built into the prompt architecture from the start (rotate openers, vary CTAs, use per-user writing style seed from resume). Test 20+ generations before release. Homogenized output gets collectively flagged by spam filters. Address in: Email Generation phase.

Additional pitfalls to plan for: scraping rate limiting (cache for 7 days, 1-3s request delay, detect block patterns); stale contact data (model `last_verified_at`, flag contacts older than 90 days); Apollo credit exhaustion (check balance before enrichment batches, per-user quotas); CAN-SPAM/GDPR suppression list (functional unsubscribe with backend suppression must ship with email sending, not after).

---

## Implications for Roadmap

Based on the dependency analysis from FEATURES.md and the build order from ARCHITECTURE.md, the following phase structure is recommended. Deviating from this order creates hard blockers downstream.

### Phase 1: Foundation — Auth, User Model, and Onboarding

**Rationale:** Everything depends on `userId`. No feature can be built until the user model, authentication, and session management exist. The onboarding wizard is Phase 1, not Phase 2 — it's the activation mechanism and the first thing users experience.

**Delivers:** Working multi-user app with Supabase Auth (Google OAuth), user profile with encrypted credential storage, onboarding wizard (sender info + Gmail OAuth connect + resume upload + email template), Prisma schema (all tables) with RLS enabled from day one.

**Addresses:** User account, onboarding wizard, resume upload, email template input (table stakes from FEATURES.md)

**Avoids:** Supabase RLS misconfiguration pitfall — RLS must be enabled on every table before any data is written. Data isolation tests should be written in this phase.

**Research flag:** Standard patterns. Supabase Auth + Next.js App Router is well-documented with official guides.

---

### Phase 2: Background Infrastructure — Redis, BullMQ, Worker Process

**Rationale:** Scraping, email sending, and reply detection all depend on the queue infrastructure. Building the worker skeleton before writing any worker logic prevents the common mistake of writing synchronous operations that later need to be refactored into jobs.

**Delivers:** Upstash Redis connected, BullMQ queue definitions (scrape-queue, email-queue, reply-queue), worker process entry point running on Railway/Fly.io, Bull Board admin UI behind auth middleware, idempotency pattern established (deterministic job IDs + DB state checks).

**Addresses:** Background job idempotency pitfall; confirms deployment split works before any business logic is built on top of it.

**Avoids:** Running BullMQ on Vercel (architectural anti-pattern confirmed in research), duplicate email pitfall.

**Research flag:** Needs research-phase. Railway + Vercel monorepo deployment with shared environment has nuances worth investigating before committing to a structure.

---

### Phase 3: Lead Discovery — Scraping and Data Pipeline

**Rationale:** AI email generation requires leads; leads require the scraper pipeline. YC first (simplest, public JSON endpoint), then Product Hunt (GraphQL API) and additional sources (HN Hiring, Gregslist, VC portfolios). Shared global pool upsert pattern established here determines data model correctness for all future phases.

**Delivers:** YC scraper (Playwright/JSON endpoint), Product Hunt scraper (GraphQL API), shared `companies` + `contacts` tables populated via upsert, lead dashboard with basic filters, `last_verified_at` on contacts from day one.

**Addresses:** Startup-specific discovery, lead dashboard, lead filtering (table stakes + differentiator from FEATURES.md)

**Avoids:** Aggressive scraping pitfall — rate limiting (1-3s delays), 7-day cache TTL, per-source error rate monitoring, and block detection must be built into the scrape worker before any scale testing.

**Research flag:** Standard patterns for YC JSON endpoint and Product Hunt GraphQL API. Additional sources (HN Hiring, Gregslist, VC portfolios) use static HTML scrapers via Cheerio.

---

### Phase 4: Email Generation — Claude API and AI Drafts

**Rationale:** Email generation depends on leads existing (Phase 3) and the resume being stored (Phase 1). This is the product's core value — it must work reliably before the send flow is connected.

**Delivers:** Claude API integration with per-user API key injection, prompt architecture with structural variation (per-user writing style seed, opener rotation, CTA variation), resume summarization (cache summary, not full resume per generation), email draft saved to DB, email preview UI with inline editing before send.

**Addresses:** AI email generation, email preview (table stakes); AI tone matching, resume-as-context (differentiators from FEATURES.md)

**Avoids:** AI email homogeneity pitfall — variation must be designed into the prompt now, not added after users report deliverability problems. Test 20+ generations before declaring this phase done.

**Research flag:** Needs research-phase. Optimal Claude prompt architecture for cold email generation with per-user tone variation is worth a focused prompt engineering spike.

---

### Phase 5: Email Sending — Gmail OAuth and Send Infrastructure

**Rationale:** Sending depends on drafts existing (Phase 4). This phase connects the full loop: generate → review → send. Compliance infrastructure (suppression list, CAN-SPAM footers) is a prerequisite for this phase, not a follow-up task.

**Delivers:** Gmail OAuth2 send via Nodemailer transport in BullMQ worker, unique `Message-ID` header stored on every sent email, daily send cap enforcement at job level (not UI), suppression list table with global opt-out enforcement as pre-send gate, CAN-SPAM-compliant email footer (physical address + unsubscribe link), per-lead status updated to SENT, sent email history.

**Addresses:** Direct email send, sent email history, per-lead status, basic sending limits, unsubscribe handling (all table stakes from FEATURES.md)

**Avoids:** Cold domain/warmup pitfall (caps enforced), CAN-SPAM/GDPR pitfall (suppression list ships with sending, not after), OAuth scope pitfall (minimum scopes, token health checks), Nodemailer transport per-request anti-pattern (send in worker, not API route).

**Research flag:** Standard patterns. Gmail OAuth2 + Nodemailer in BullMQ worker is well-documented.

---

### Phase 6: Reply Detection and Follow-Ups

**Rationale:** Reply detection depends on sent emails with stored `Message-ID` headers (Phase 5). Follow-up reminders depend on knowing when emails were sent and whether replies have arrived. This phase closes the outreach loop.

**Delivers:** BullMQ repeatable reply-detection job (10-min interval per active user), IMAP polling via `imapflow` matching `In-Reply-To` headers against stored `messageId` values, auto-update of email status to REPLIED, cancellation of pending follow-up jobs on reply detected, follow-up reminder BullMQ delayed job (configurable N days after send), token health check job surfacing disconnected state in dashboard.

**Addresses:** Reply detection, follow-up reminders, status tracking (table stakes from FEATURES.md)

**Avoids:** Reply detection token expiry pitfall (health check runs independently), IMAP polling in API route anti-pattern.

**Research flag:** Needs research-phase. Gmail API push notifications (Cloud Pub/Sub) vs IMAP polling tradeoffs at the expected user scale are worth evaluating. Push is more reliable but requires domain verification and more OAuth setup. Confirm which approach is appropriate for MVP scale before implementation.

---

### Phase 7: Polish, Differentiators, and v1.x Features

**Rationale:** With the core loop working end-to-end, this phase adds the features that differentiate the product and improve retention.

**Delivers:** Product Hunt discovery source, region grouping for location filters, follow-up email AI generation (Claude generates follow-up draft, not just a reminder), deliverability guidance UI (SPF/DKIM/DMARC checklist, sending status indicators), collaborator/co-founder mode (different tone, different role filters), Apollo enrichment integration (per-user API key, credit balance visibility, enrichment cache).

**Addresses:** Product Hunt discovery, collaborator mode, follow-up AI generation, agentic context gathering (differentiators from FEATURES.md); Apollo credit exhaustion pitfall; stale contact data pitfall.

**Research flag:** Needs research-phase for agentic context gathering. The pattern of fetching live company context (recent Product Hunt launch, company description) before email generation has limited prior art — the implementation approach needs a spike.

---

### Phase Ordering Rationale

- **Auth before everything:** `userId` is required on every per-user record. Building any feature without a working user model creates throwaway code.
- **Infrastructure before logic:** The worker process skeleton must exist before scraping or sending jobs are written. Retrofitting BullMQ into synchronous code is painful and error-prone.
- **Scraping before generation:** AI generation requires a company+contact to generate for. The data pipeline must produce leads before the generation UI is useful.
- **Generation before sending:** The send flow assumes a reviewed draft exists. Building sending before generation creates an incomplete user flow that cannot be validated.
- **Sending before reply detection:** Reply detection matches against `Message-ID` headers stored at send time. There is nothing to detect without sent emails.
- **Compliance (suppression list, CAN-SPAM footers) is not a phase** — it is a prerequisite for Phase 5 (Email Sending) and must be built before sending goes live.

---

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 2 (Background Infrastructure):** Railway + Vercel monorepo deployment configuration. Confirm the worker deployment pattern before committing to the directory structure.
- **Phase 3 (Lead Discovery):** Additional ingest sources (HN Hiring, Gregslist, VC portfolios). Confirm scraper approach for each source before writing the worker.
- **Phase 4 (Email Generation):** Claude prompt architecture for multi-user tone variation. A prompt engineering spike before full implementation is worth the time investment.
- **Phase 6 (Reply Detection):** Gmail push notifications (Pub/Sub) vs IMAP polling. Evaluate which approach suits MVP scale before building the reply worker.
- **Phase 7 (Differentiators):** Agentic company context gathering pattern. The approach for fetching live company context and injecting it into the prompt needs a spike.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Foundation):** Supabase Auth + Next.js App Router is thoroughly documented with official guides and community examples.
- **Phase 5 (Email Sending):** Gmail OAuth2 + Nodemailer + BullMQ is a well-worn pattern with official documentation from all three libraries.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core stack is mandated and confirmed via official docs. Version compatibility matrix verified. Main uncertainty: Prisma 7 pure TS client timeline (MEDIUM — multiple web sources agree but not yet GA). |
| Features | MEDIUM-HIGH | Table stakes derived from competitor analysis with named sources. Differentiators are inferred from niche gap analysis; real user validation needed. Anti-features are well-reasoned with precedent. |
| Architecture | HIGH | Patterns verified against official BullMQ, Next.js, Supabase, and Nodemailer documentation. The Vercel/worker split constraint is confirmed by multiple community reports. DB schema design follows documented multi-tenancy patterns. |
| Pitfalls | HIGH | Most pitfalls are cross-verified with official sources (Gmail API docs, BullMQ docs, Supabase RLS docs, CAN-SPAM law text). Deliverability pitfalls are MEDIUM (industry consensus, not formally measured). |

**Overall confidence:** HIGH for architecture and technology choices; MEDIUM for feature prioritization (niche is underserved so there is limited external validation data).

### Gaps to Address

- **Student/collaborator user persona validation:** The feature research identifies this as an underserved niche, but the specific features that drive activation and retention for students (vs job-seekers vs co-founder seekers) need user research or a beta cohort. The collaborator mode differentiation is an inference; validate before building.
- **Apollo API tier requirements:** The free tier (600 credits/month) is likely insufficient for meaningful use. The pricing model for the product needs to account for Apollo credit costs per user. This gap affects Phase 7 planning.
- **Additional ingest source coverage:** HN Hiring, Gregslist, and individual VC portfolio scrapers (a16z, Accel, Bessemer, etc.) are active sources. Confirm scraper approach and data quality for each before scheduling scrape runs.
- **Auth.js/Better Auth transition:** The research notes that the Auth.js team announced joining Better Auth in late 2025 (MEDIUM confidence, single source). This does not affect the recommendation (Supabase Auth is preferred anyway), but the finding should be validated if any team member advocates for Auth.js.
- **Prisma 7 GA timeline:** If Prisma 7 ships GA before Phase 1 begins, the project should start with Prisma 7 for better serverless cold starts. If not, Prisma 5 is the correct choice with a clean migration path.

---

## Sources

### Primary (HIGH confidence)
- Supabase Auth + Next.js App Router: https://supabase.com/docs/guides/auth/server-side/nextjs
- Prisma + Supabase connection modes: https://supabase.com/docs/guides/database/prisma
- BullMQ official docs — architecture: https://docs.bullmq.io/guide/architecture
- BullMQ Vercel incompatibility: https://community.vercel.com/t/issues-with-bullmq-worker-not-running-in-vercel-production-environment/687
- Gmail API push notifications: https://developers.google.com/gmail/api/guides/push
- Gmail API OAuth scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Google Workspace legacy auth deprecation (May 2025): https://support.google.com/a/answer/14114704?hl=en
- Nodemailer Gmail OAuth2: https://nodemailer.com/smtp/oauth2
- shadcn/ui Tailwind v4 support: https://ui.shadcn.com/docs/tailwind-v4
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Apollo.io Rate Limits: https://docs.apollo.io/reference/rate-limits
- Product Hunt GraphQL V2 API: https://api.producthunt.com/v2/docs
- Next.js official — Backend for Frontend: https://nextjs.org/docs/app/guides/backend-for-frontend
- Upstash Redis pricing (March 2025): https://upstash.com/blog/redis-new-pricing

### Secondary (MEDIUM confidence)
- Cold Outreach tools landscape 2026: https://www.findymail.com/blog/best-cold-outreach-tools/
- Apollo vs Lemlist 2026: https://lagrowthmachine.com/apollo-vs-lemlist/
- Cold email deliverability 2026: https://instantly.ai/blog/how-to-achieve-90-cold-email-deliverability-in-2025/
- Gmail sending limits 2026: https://www.smartlead.ai/blog/gmail-sending-limits
- Email domain warm-up 2026: https://www.mailreach.co/blog/how-to-warm-up-email-domain
- Playwright vs Puppeteer 2025: https://blog.apify.com/playwright-vs-puppeteer/
- Prisma 7 pure TypeScript client: WebSearch (multiple sources confirm, not yet GA)
- Auth.js joining Better Auth (late 2025): WebSearch — single source, needs validation

### Tertiary (LOW confidence)
- How AI spam filters work 2026: https://medium.com/@genai.works/how-ai-spam-filters-actually-work-in-2026-e4546d39d56d — single source, needs validation

---

*Research completed: 2026-03-15*
*Ready for roadmap: yes*
