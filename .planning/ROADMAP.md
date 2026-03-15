# Roadmap: Cold Email Automation

## Overview

Three phases deliver the complete cold email loop. Phase 1 establishes the user model, authentication, and onboarding so every subsequent feature has a `userId` to anchor to. Phase 2 builds the background job infrastructure and lead discovery pipeline that populates the shared company/contact pool users browse and filter. Phase 3 closes the loop: AI email generation from the user's resume and lead context, Gmail-based sending with compliance guardrails, and reply detection with follow-up reminders. After Phase 3, users can go from zero to sent personalized email in one session.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - User accounts, authentication, and onboarding wizard (resume, sender info, API keys, email template)
- [ ] **Phase 2: Discovery** - Background job infrastructure, scrapers, shared lead pool, lead dashboard with filters and management
- [ ] **Phase 3: Outreach Loop** - AI email generation, Gmail sending with compliance, reply detection, and follow-up reminders

## Phase Details

### Phase 1: Foundation
**Goal**: A new user can sign up, authenticate, and complete onboarding — leaving the wizard with their resume stored, sender identity configured, Gmail connected, and API keys saved.
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, ONBD-01, ONBD-02, ONBD-03, ONBD-04
**Success Criteria** (what must be TRUE):
  1. User can create an account with email/password or sign in with Google OAuth and remain logged in across browser refresh
  2. User can upload or paste their resume during onboarding and see it stored on their profile
  3. User can set their sender name, title, and a base email template that persists to future sessions
  4. User can store encrypted API keys (Apollo, Claude) that are retrievable in later flows without re-entry
  5. User can set default lead filters (industry, funding stage, location, contact role) that pre-populate the discovery view
**Plans**: TBD

Plans:
- [ ] 01-01: Project scaffold — Next.js 15 App Router, Prisma schema, Supabase Auth, RLS on all tables, environment config
- [ ] 01-02: Onboarding wizard — resume upload, sender info, Gmail OAuth connect, API key storage, default filter preferences

### Phase 2: Discovery
**Goal**: Users can browse a live pool of startup companies and contacts sourced from YC, Wellfound, and Product Hunt, filter it to their preferences, and save leads to their personal list for outreach.
**Depends on**: Phase 1
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, LEAD-01, LEAD-02, LEAD-03, LEAD-04
**Success Criteria** (what must be TRUE):
  1. Background job worker (Railway) is running and the BullMQ scrape queue populates the shared `companies` and `contacts` tables from YC and Wellfound without duplicates
  2. User can open the lead dashboard and see companies filterable by funding stage, industry, location (with region grouping), company size, is-hiring, and contact role
  3. User can save individual leads from the global pool to their personal list and tag them as New / Saved / Emailed / Rejected
  4. User can manually add a company and contact that does not appear in the scraped pool
  5. User can bulk-select leads from the dashboard and queue them for batch email generation
**Plans**: TBD

Plans:
- [ ] 02-01: BullMQ worker skeleton — Upstash Redis, queue definitions (scrape/email/reply), Railway worker deployment, Bull Board admin UI, idempotency pattern
- [ ] 02-02: Lead discovery — YC scraper, Wellfound scraper, Apollo contact enrichment, shared pool upsert, `last_verified_at` on contacts
- [ ] 02-03: Lead dashboard — filterable/searchable table, region grouping, save to personal list, status tags, bulk selection, manual add

### Phase 3: Outreach Loop
**Goal**: Users can generate a personalized AI-drafted email for any lead, review and edit it, send it from their own Gmail account, and track replies and follow-up reminders — completing the full cold outreach cycle in one product.
**Depends on**: Phase 2
**Requirements**: EGEN-01, EGEN-02, EGEN-03, EGEN-04, SEND-01, SEND-02, SEND-03, SEND-04, TRAK-01, TRAK-02, TRAK-03, TRAK-04
**Success Criteria** (what must be TRUE):
  1. User can trigger email generation for a lead and receive a draft that uses their resume, email template, and live company context — with structural variation that avoids AI-pattern signatures
  2. User can preview and edit the generated draft in the UI before sending, and the edited version is what gets sent
  3. User can send the email from their connected Gmail account and see it appear in the sent email dashboard with status Sent
  4. App enforces a daily send cap per user and attaches a CAN-SPAM-compliant footer (unsubscribe link, physical sender address) to every outgoing email
  5. App auto-detects a reply to a sent email and updates the email status to Replied; user receives a follow-up reminder if no reply arrives within a configurable number of days
**Plans**: TBD

Plans:
- [ ] 03-01: Email generation — Claude API integration with per-user key injection, agentic company context fetch, prompt architecture with structural variation, resume summarization cache, draft saved to DB
- [ ] 03-02: Email sending — Gmail OAuth2 send via BullMQ worker, unique Message-ID stored, daily send cap enforcement, suppression list, CAN-SPAM footer, scheduled send
- [ ] 03-03: Tracking and follow-ups — email dashboard, manual status management, IMAP reply detection via repeatable BullMQ job, follow-up reminder delayed jobs, token health check

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/2 | Not started | - |
| 2. Discovery | 0/3 | Not started | - |
| 3. Outreach Loop | 0/3 | Not started | - |
