# Stack Research

**Domain:** Cold email outreach SaaS (multi-user, data-enrichment, AI generation, background processing)
**Researched:** 2026-03-15
**Confidence:** MEDIUM-HIGH (core stack confirmed; some library specifics are training-data-supported with partial web verification)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | 15.x (App Router) | Full-stack framework: frontend + API routes + server actions | Stack mandated. App Router provides server components, streaming, and route handlers — all needed here. Avoid Pages Router for new projects. |
| TypeScript | 5.x | Type safety across entire codebase | Non-negotiable with Prisma (codegen), Zod, and Claude SDK — all provide first-class TypeScript types. |
| Tailwind CSS | 4.x | Utility-first CSS | shadcn/ui components require Tailwind. v4 ships with Next.js 15 natively; no PostCSS config needed. |
| shadcn/ui | latest (canary supports Tailwind v4) | Headless, accessible component primitives | Copy-paste model means full ownership. Trusted by OpenAI, Adobe, others. All components updated for Tailwind v4 + React 19. Better than MUI for custom dashboards. |
| PostgreSQL via Supabase | Postgres 15 (Supabase managed) | Primary relational database | Stack mandated. Supabase manages connection pooling (PgBouncer/Supavisor), backups, and RLS out of the box. |
| Prisma ORM | 5.x (or 7.x when stable, pure TypeScript client) | Database access layer, schema management, migrations | Stack mandated. Prisma 7 eliminates the Rust binary for a pure-TypeScript client — same DX, better serverless cold starts. For v1 on Vercel serverless, use Prisma 5 with `DATABASE_URL` pointing at Supabase's **session pooler (port 5432)** and `DIRECT_URL` pointing at direct connection. |
| Supabase Auth | via `@supabase/ssr` | Multi-user authentication (JWT + cookie sessions) | See decision section below. Tight RLS integration eliminates separate authorization layer. |
| Redis (Upstash) | Redis 7 (serverless via Upstash) | BullMQ job queue backing store | Upstash is serverless-compatible Redis, available natively on Vercel Marketplace. Free tier: 500K commands/month (updated March 2025). Avoid self-hosted Redis if deploying workers on Railway/Fly — use Upstash for unified managed Redis. |
| BullMQ | 5.x | Background job queue for scraping, enrichment, email generation | Stack mandated. Successor to Bull. Robust retry, delay, rate-limiting, concurrency controls. The Workers MUST run as a separate process (not inside Vercel serverless — see architecture section). |
| Claude API (`@anthropic-ai/sdk`) | 0.x latest (>=0.20) | AI email generation | Stack mandated. Official TypeScript SDK. Supports streaming, retries, typed message objects. Node.js 20+ required. Use `claude-opus-4` or `claude-sonnet-4-5` model depending on cost/quality tradeoff. |

---

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/supabase-js` | 2.x | Supabase client for DB + Auth operations | All server-side Supabase calls (queries, auth, storage) |
| `@supabase/ssr` | 0.x latest | Cookie-based session management for Next.js SSR/RSC | Required for App Router — handles session refresh in middleware, server components, route handlers |
| `nodemailer` | 6.x | SMTP/Gmail email sending | All outbound email sending from the app. Supports OAuth2 token refresh. |
| `googleapis` | 144.x | Gmail API — send, reply-to tracking, thread polling | Preferred over raw Nodemailer for Gmail because it handles OAuth2 token lifecycle and gives access to Gmail push notifications (Pub/Sub) and thread metadata |
| `@google-cloud/pubsub` | 4.x | Gmail push notifications for reply auto-detection | Required for auto-detecting replies without polling. Gmail API pushes to Pub/Sub; you subscribe and update lead status. |
| `playwright` | 1.x | Browser-based scraping for YC | YC HN directory requires JS rendering. Playwright handles SPAs and dynamic content. Use Chromium-only for reduced binary size. |
| `cheerio` | 1.x | HTML parsing for static pages | Use as a fast fallback when a page is server-rendered (no JS). Pair with `node-fetch` or Axios. 70% faster than browser-based scraping for static content. |
| `axios` | 1.x | HTTP client for Apollo.io REST API + Product Hunt GraphQL | Simple, well-typed, works with interceptors for API key injection |
| `ioredis` | 5.x | Redis client used internally by BullMQ | Required by BullMQ. Do not use the `redis` package — BullMQ only supports `ioredis`. |
| `zod` | 3.x | Schema validation (forms, API inputs, env vars) | Use everywhere — form validation with `react-hook-form`, server action input validation, env schema via `@t3-oss/env-nextjs` |
| `react-hook-form` | 7.x | Form state management | All data-entry forms: onboarding wizard (resume, templates, API keys), filter configuration |
| `@hookform/resolvers` | 3.x | Zod integration for react-hook-form | Required adapter for `zodResolver()` |
| `@t3-oss/env-nextjs` | 0.x latest | Type-safe environment variable validation | Validates all required env vars at build time. Prevents runtime surprises from missing config. |
| `date-fns` | 3.x | Date formatting and manipulation | Follow-up scheduling, "sent X days ago" displays, reminder windows |
| `tsx` | 4.x | Run TypeScript files directly (for BullMQ workers) | Workers are TypeScript files that cannot run inside Next.js — `tsx` runs them as standalone scripts |
| `dotenv` | 16.x | Load .env files in worker process | Workers run outside Next.js and don't inherit `next.config.js` env loading |

---

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Prisma CLI (`prisma`) | Schema migrations, client generation, DB introspection | Run `prisma generate` after schema changes; run `prisma migrate dev` for local migration. Use `DIRECT_URL` (not pooled) for migrations. |
| Supabase CLI | Local Supabase stack, DB seed, type generation | `supabase gen types typescript` generates Supabase-typed client. Useful for raw queries bypassing Prisma. |
| ESLint + Prettier | Code quality and formatting | Use `eslint-config-next` (bundled). Add `eslint-plugin-drizzle` only if switching to Drizzle. |
| Vitest | Unit testing | Faster than Jest for TypeScript projects; integrates with Vite's transformer. Use for testing queue job logic and AI prompt output parsing. |
| BullMQ Bull Board | Queue monitoring UI | `@bull-board/api` + `@bull-board/nextjs` — mount at `/admin/queues` behind auth middleware. Provides real-time job status visibility. |

---

## Installation

```bash
# Core Next.js setup
npx create-next-app@latest --typescript --tailwind --app

# Supabase + Prisma
npm install @supabase/supabase-js @supabase/ssr
npm install prisma @prisma/client
npx prisma init

# Auth (Supabase SSR)
# No extra install — included in @supabase/ssr

# Background jobs
npm install bullmq ioredis

# Email sending
npm install nodemailer googleapis @google-cloud/pubsub
npm install -D @types/nodemailer

# AI
npm install @anthropic-ai/sdk

# Scraping
npm install playwright cheerio axios
npx playwright install chromium

# Forms + validation
npm install react-hook-form @hookform/resolvers zod

# Utilities
npm install date-fns @t3-oss/env-nextjs dotenv

# Dev tools
npm install -D tsx vitest
npm install @bull-board/api @bull-board/nextjs

# Types
npm install -D @types/node @types/react @types/react-dom
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not / When Alternative Is Better |
|-------------|-------------|--------------------------------------|
| Supabase Auth | NextAuth (Auth.js) | Auth.js development team announced joining Better Auth in late 2025 — not recommended for new projects. Supabase Auth has native RLS integration which eliminates a whole authorization layer. Choose NextAuth only if you need database-agnostic auth or multi-provider OAuth with complex session customization. |
| Supabase Auth | Clerk | Clerk costs $0.02/MAU above free tier. Supabase Auth is free up to 50K MAU. For a student-targeted SaaS, Supabase Auth is the obvious cost choice. |
| Prisma | Drizzle ORM | Drizzle is faster at cold starts and smaller bundle — but Prisma 7 (pure TypeScript client) closes that gap significantly. Prisma is mandated. Drizzle would be preferred if starting fresh today and prioritizing edge deployments. |
| Upstash Redis | Self-hosted Redis (Railway/Fly) | Self-hosted is cheaper at volume but adds ops burden. Upstash is serverless-native and available as a Vercel integration. For v1, Upstash eliminates Redis ops. |
| `googleapis` (Gmail API) | Nodemailer SMTP only | SMTP-only has no reply tracking. Gmail API enables thread inspection, push notifications via Pub/Sub, and proper OAuth2 token lifecycle management. Use `nodemailer` for SMTP fallback when users provide generic SMTP credentials. |
| Playwright | Puppeteer | Playwright supports multi-browser (Firefox, WebKit), has auto-wait built-in, and is more actively maintained. Puppeteer is Chrome-only and still appropriate for simple Chromium-only tasks. For this project's scraping scope, Playwright is the safer long-term choice. |
| Cheerio | jsdom | Cheerio is 10-15x lighter than jsdom. jsdom simulates a full browser DOM, which is unnecessary overhead for HTML parsing. |
| Apollo.io REST API (direct fetch) | Official Apollo SDK | No official Node.js Apollo.io client exists. Use `axios` with the REST API base URL `https://api.apollo.io/v1/`. Key endpoints: `/people/search`, `/organizations/search`, `/people/bulk_match`. |
| Product Hunt GraphQL API (direct) | Community wrapper | `node-producthunt-api` wraps the GraphQL V2 API but adds unnecessary abstraction. Use `graphql-request` or plain `axios` to query `https://api.producthunt.com/v2/api/graphql` directly with a Bearer token. |
| BullMQ (separate process) | Vercel background functions | BullMQ Workers cannot run on Vercel serverless (max 300s execution on Pro, function terminates after response). Workers must run as a long-lived process on Railway, Fly.io, or a small VPS. The Next.js app itself can remain on Vercel. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `bull` (original) | Unmaintained — last major release 2021. BullMQ is the official successor from the same author with a modular architecture and active development. | `bullmq` |
| `node-imap` + IMAP polling | Low-level, fragile, doesn't support Gmail's folder model well. Polling IMAP for reply detection is expensive and unreliable. | Gmail API + Google Pub/Sub push notifications |
| `SendGrid` / `Resend` for outbound cold emails | These transactional email services are for system emails (password resets, notifications), not for sending personalized cold emails from the *user's own Gmail account*. They won't satisfy the "send from user's account" requirement and add unnecessary cost. | `nodemailer` + Gmail API OAuth2 (user's own Gmail) |
| `NextAuth` / `Auth.js` v5 for new projects | Auth.js development team announced joining Better Auth in late 2025; Auth.js receives only security patches. New projects should not invest in it. | Supabase Auth |
| LinkedIn scraping | LinkedIn aggressively litigates scrapers (hiQ v. LinkedIn). Already in scope as out-of-scope. Do not attempt. | Use Apollo.io API for contact enrichment |
| Clearbit | Expensive ($99+/month) for the volume needed. | Apollo.io API (already in stack) |
| `@vercel/kv` | Thin wrapper around Upstash that locks you into Vercel. Adds abstraction with no benefit over direct `ioredis` for BullMQ. | `ioredis` directly against Upstash Redis URL |
| Drizzle ORM (in this project) | Stack specifies Prisma. Mixing ORMs adds complexity. | Prisma |
| Puppeteer | Playwright is strictly superior in 2025 for multi-target scraping. Puppeteer remains Chrome-only. | Playwright (Chromium-only install) |

---

## Stack Patterns by Variant

**For email sending (user has Gmail):**
- Use `googleapis` for OAuth2 authorization code flow
- Store `refresh_token` encrypted in user record (Supabase DB, encrypted at rest)
- Use `nodemailer` transporter with `googleapis` OAuth2 provider for actual SMTP send
- Use Gmail API `messages.list` + Pub/Sub push for reply detection

**For email sending (user provides generic SMTP):**
- Store host, port, username, and encrypted app password in user settings
- Use `nodemailer` SMTP transport directly
- Reply detection: periodic BullMQ job polling IMAP via `imap-simple` library

**For scraping YC directory:**
- YC company directory at `https://www.ycombinator.com/companies` is a React SPA
- Use Playwright to scroll/paginate and extract JSON embedded in `__NEXT_DATA__` where available
- Fallback to DOM scraping via `page.$$eval()` selectors

**For Apollo.io contact data:**
- Use REST API `POST /api/v1/people/search` with filters for startup employees
- User provides their own API key (stored encrypted in user settings) — this avoids shared rate limits
- Apollo free tier: 600 credits/month; paid tiers scale with usage

**For Product Hunt:**
- Official GraphQL V2 API at `https://api.producthunt.com/v2/api/graphql`
- Use client credentials OAuth flow (no user login needed for public data)
- Query `posts` with date and topic filters to find recently launched startups

**If deploying workers separately (Railway/Fly.io):**
- Workers share the same codebase as the Next.js app
- Use monorepo-style `apps/web` + `apps/worker` or a single repo with separate entry points
- Worker entry: `src/workers/index.ts` — runs a long-lived process that registers all BullMQ Workers
- Share environment via Upstash Redis URL available to both Vercel and Railway

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `next@15.x` | `react@19.x`, `react-dom@19.x` | React 19 is required for Next.js 15. shadcn/ui canary supports React 19. |
| `prisma@5.x` | `@prisma/client@5.x` | Always pin both to same major version. Run `prisma generate` after any schema change. |
| `@supabase/ssr@0.x` | `@supabase/supabase-js@2.x` | Use `@supabase/ssr` for App Router — NOT the deprecated `@supabase/auth-helpers-nextjs`. |
| `bullmq@5.x` | `ioredis@5.x` | BullMQ does NOT support the `redis` npm package — only `ioredis`. |
| `tailwindcss@4.x` | `shadcn/ui canary` | shadcn/ui stable release targets Tailwind v3; use `canary` channel for v4 support. |
| `prisma@5.x` | Supabase Postgres 15 | Use `SESSION_MODE` connection string (port 5432) for Prisma. Do NOT use transaction pooler (port 6543) with Prisma — it breaks prepared statements. |
| `@anthropic-ai/sdk` | Node.js >= 20 | SDK requires Node 20 LTS or later. Ensure Railway/Fly worker image uses Node 20. |

---

## Critical Architecture Note: BullMQ Cannot Run on Vercel

Vercel serverless functions terminate after sending a response (max 300s on Pro). BullMQ Workers require a persistent, long-running process. This is the single biggest infrastructure constraint in the stack.

**Required deployment split:**
- **Vercel**: Next.js app (frontend + API route handlers + server actions)
- **Railway or Fly.io**: BullMQ worker process (scraping jobs, AI generation jobs, email jobs)
- **Upstash**: Redis backing store for BullMQ (accessible from both Vercel and Railway)

Next.js Route Handlers enqueue jobs (`Queue.add()`). Workers on Railway dequeue and process them. This is a clean separation and the standard pattern for Next.js + BullMQ in production.

---

## Sources

- Supabase Auth + Next.js App Router: https://supabase.com/docs/guides/auth/server-side/nextjs — HIGH confidence
- BullMQ Vercel incompatibility: https://community.vercel.com/t/issues-with-bullmq-worker-not-running-in-vercel-production-environment/687 — HIGH confidence (confirmed limitation)
- Upstash Redis pricing (March 2025 update): https://upstash.com/blog/redis-new-pricing — HIGH confidence
- Prisma + Supabase connection modes: https://supabase.com/docs/guides/database/prisma — HIGH confidence
- shadcn/ui Tailwind v4 support: https://ui.shadcn.com/docs/tailwind-v4 — HIGH confidence
- Product Hunt GraphQL V2 API: https://api.producthunt.com/v2/docs — HIGH confidence
- Apollo.io REST API: https://docs.apollo.io/docs/api-overview — HIGH confidence
- Playwright vs Puppeteer 2025: https://blog.apify.com/playwright-vs-puppeteer/ — MEDIUM confidence (WebSearch, multiple sources agree)
- Nodemailer Gmail OAuth2: https://nodemailer.com/smtp/oauth2 — HIGH confidence
- Auth.js joining Better Auth (late 2025): WebSearch — MEDIUM confidence (single source, flag for validation)
- Cheerio vs Playwright hybrid strategy: https://dev.to/withatte/stop-writing-selectors-how-i-vibe-coded-a-production-appsumo-scraper-1a3 — MEDIUM confidence
- Gmail API push notifications: https://developers.google.com/gmail/api/guides/push — HIGH confidence
- Prisma 7 pure TypeScript client: WebSearch (multiple sources confirm) — MEDIUM confidence


---

*Stack research for: cold email outreach SaaS*
*Researched: 2026-03-15*
