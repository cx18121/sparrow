# Architecture Research

**Domain:** Cold email outreach SaaS (multi-user, shared data pool, background job processing)
**Researched:** 2026-03-15
**Confidence:** HIGH (stack is fixed; patterns verified against official docs and community sources)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PRESENTATION LAYER                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Dashboard   │  │ Lead Browser │  │ Email Compose│               │
│  │  (React/RSC) │  │  (React/RSC) │  │  (React/RSC) │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
└─────────┼─────────────────┼─────────────────┼─────────────────────┘
          │                 │                 │
┌─────────▼─────────────────▼─────────────────▼─────────────────────┐
│                       NEXT.JS API LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  /api/leads  │  │ /api/emails  │  │ /api/scraper │               │
│  │  (Route.ts)  │  │  (Route.ts)  │  │  (Route.ts)  │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                 │                        │
│  ┌──────▼─────────────────▼─────────────────▼──────────────────┐    │
│  │                    SERVICE LAYER                              │    │
│  │  LeadService  |  EmailService  |  ScraperService  |  AIService│   │
│  └──────────────────────────────┬────────────────────────────────┘   │
└─────────────────────────────────┼──────────────────────────────────┘
                                  │
┌─────────────────────────────────▼──────────────────────────────────┐
│                      BACKGROUND WORKER PROCESS                       │
│  (Separate Node.js process — NOT on Vercel serverless)              │
│                                                                       │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐         │
│  │  scrape-queue  │  │  email-queue   │  │  reply-queue   │         │
│  │  BullMQ Worker │  │  BullMQ Worker │  │  BullMQ Worker │         │
│  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘         │
└──────────┼───────────────────┼───────────────────┼──────────────────┘
           │                   │                   │
┌──────────▼───────────────────▼───────────────────▼──────────────────┐
│                         DATA LAYER                                    │
│  ┌──────────────────────────┐    ┌─────────────────────────┐        │
│  │   PostgreSQL (Supabase)  │    │   Redis (BullMQ queues) │        │
│  │   via Prisma ORM         │    │   Job state + progress  │        │
│  └──────────────────────────┘    └─────────────────────────┘        │
└──────────────────────────────────────────────────────────────────────┘
           │
┌──────────▼───────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Claude   │  │ Apollo   │  │ Gmail    │  │ YC / PH  │             │
│  │ API      │  │ API      │  │ SMTP+    │  │ Scrapers │             │
│  │          │  │          │  │ IMAP     │  │          │             │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘             │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| Next.js App Router | Routing, SSR, API surface, auth middleware | `app/` directory, Route Handlers |
| Service Layer | Business logic, orchestration, validation | `src/services/*.ts` modules |
| BullMQ Worker Process | Long-running background jobs (scraping, email send, reply polling) | Separate Node.js process, deployed separately from Vercel |
| Prisma ORM | Database access, schema management, migrations | Single Prisma client instance |
| Redis | BullMQ job queue state, job results, rate-limit counters | Upstash Redis or Railway Redis |
| Claude API Client | Email generation, context assembly | Wrapped in `AIService` |
| Apollo API Client | Contact and company enrichment | Wrapped in `EnrichmentService` |
| Nodemailer / Gmail | Email sending via user OAuth2 tokens | Per-user credentials, per-send transport |
| IMAP Poller | Reply detection via In-Reply-To header matching | BullMQ repeatable job, `imapflow` library |

---

## Recommended Project Structure

```
src/
├── app/                       # Next.js App Router
│   ├── (auth)/                # Auth pages (login, signup, onboarding)
│   ├── (dashboard)/           # Protected dashboard pages
│   │   ├── leads/             # Lead browser and detail views
│   │   ├── emails/            # Email compose, history, thread view
│   │   └── settings/          # User profile, API keys, templates
│   └── api/                   # Route handlers (thin — delegate to services)
│       ├── leads/route.ts
│       ├── emails/route.ts
│       ├── scrape/route.ts    # Enqueues scrape job, returns jobId
│       └── webhooks/route.ts  # For future inbound webhook use
│
├── services/                  # Business logic — no HTTP, no Prisma calls
│   ├── lead.service.ts        # Lead list CRUD, filtering, deduplication
│   ├── email.service.ts       # Email generate/send/status management
│   ├── ai.service.ts          # Claude API wrapper, prompt assembly
│   ├── enrichment.service.ts  # Apollo API calls, contact resolution
│   └── reply.service.ts       # Reply detection, follow-up scheduling
│
├── jobs/                      # BullMQ queue definitions and worker handlers
│   ├── queues.ts              # Queue instances (single source of truth)
│   ├── workers/
│   │   ├── scrape.worker.ts   # YC / PH / Wellfound scraping job
│   │   ├── email.worker.ts    # Email send job (uses Nodemailer)
│   │   └── reply.worker.ts    # IMAP poll job (repeatable, per-user)
│   └── worker-process.ts      # Entry point: registers all workers, starts process
│
├── lib/                       # Shared utilities and singleton clients
│   ├── prisma.ts              # Prisma client singleton
│   ├── redis.ts               # Redis connection singleton
│   ├── claude.ts              # Anthropic SDK client
│   └── gmail.ts               # Nodemailer transport factory (per-user OAuth2)
│
├── db/                        # Database schema and migrations
│   └── schema.prisma
│
└── types/                     # Shared TypeScript types
    ├── leads.ts
    ├── emails.ts
    └── jobs.ts
```

### Structure Rationale

- **`app/api/` (thin routes):** Route handlers only validate input, call a service, and return a response. Business logic never lives here. This keeps routes testable and replaceable.
- **`services/` (business logic):** Pure TypeScript functions with no HTTP or transport concerns. Called by both API routes and BullMQ workers — critical for avoiding duplication.
- **`jobs/` (worker process):** Entirely separate from Next.js runtime. Worker process is started independently (`node src/jobs/worker-process.ts`), connects to the same Redis and Postgres, and runs on a non-Vercel host (Railway, Fly.io, or a VPS).
- **`lib/` (singleton clients):** Prevents connection pool exhaustion. Prisma and Redis clients are instantiated once and reused.

---

## Architectural Patterns

### Pattern 1: Shared Global Pool with Per-User Overlay

**What:** Companies and contacts live in shared tables with no `userId`. Per-user data (lead lists, email history, status) lives in separate tables with a `userId` foreign key.

**When to use:** Always — this is the core data model for this project. It prevents re-fetching the same company from Apollo for every user.

**Trade-offs:** Slightly more complex joins; requires care to never expose another user's private data. Simple to enforce via Prisma queries that always `where: { userId: session.user.id }` on user-scoped tables.

**Example:**
```typescript
// Shared — no userId
const company = await prisma.company.upsert({
  where: { domain: "example.com" },
  update: { updatedAt: new Date() },
  create: { name: "Acme", domain: "example.com", stage: "Seed" },
});

// Per-user — always scoped
const lead = await prisma.userLead.create({
  data: {
    userId: session.user.id,
    companyId: company.id,
    status: "NEW",
  },
});
```

### Pattern 2: Thin API Route → Service Layer

**What:** API routes (`route.ts`) perform only: auth check, input parsing, service call, response serialization. All logic is in `services/`.

**When to use:** Every API route. This is the standard Next.js App Router pattern recommended by the official docs (Backend for Frontend guide).

**Trade-offs:** Minor boilerplate. Pays back immediately when the same logic needs to run from a BullMQ worker or a cron job.

**Example:**
```typescript
// app/api/emails/route.ts
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = await req.json();
  const email = await emailService.generate({
    userId: session.user.id,
    leadId: body.leadId,
  });

  return Response.json(email);
}
```

### Pattern 3: BullMQ Enqueue from API, Process in Worker

**What:** Next.js API routes add jobs to BullMQ queues. A separate long-running Node.js process (the worker) picks them up and processes them. Workers call the same service layer as API routes.

**When to use:** Any operation that is too slow for a synchronous HTTP response: scraping, email sending, IMAP polling, AI generation for batches.

**Trade-offs:** Requires separate deployment target for the worker process. Vercel cannot host BullMQ workers — they require a persistent process. Railway or Fly.io handle this cleanly.

**Example:**
```typescript
// API route — enqueue only
import { scrapeQueue } from "@/jobs/queues";

export async function POST(req: Request) {
  const job = await scrapeQueue.add("scrape-yc", { userId, filters });
  return Response.json({ jobId: job.id });
}

// Worker process (separate, long-running)
const worker = new Worker("scrape", async (job) => {
  await scraperService.runYCScrape(job.data.userId, job.data.filters);
}, { connection: redis, concurrency: 3 });
```

### Pattern 4: Reply Detection via Message-ID Tracking

**What:** When sending an email, generate a unique `Message-ID` header, store it on the `Email` record. A repeatable BullMQ job polls Gmail IMAP for each user, checks `In-Reply-To` headers against stored Message-IDs, and updates email status on match.

**When to use:** Required for reply tracking without Gmail API webhook setup (which requires domain verification and more OAuth scope complexity).

**Trade-offs:** Polling introduces latency (configurable — 5–15 min is reasonable). More robust than pixel tracking. Does not require Google Workspace.

---

## Database Schema Sketch

```
┌──────────────────────────────────────────────────────────────────────┐
│                        GLOBAL SHARED TABLES                           │
│                        (no userId — shared across all users)          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  companies                    contacts                                │
│  ──────────                   ────────                                │
│  id (uuid PK)                 id (uuid PK)                           │
│  name                         companyId (FK → companies)             │
│  domain                       name                                    │
│  stage (Seed/Series A/…)      email                                  │
│  industry                     role / title                           │
│  location                     linkedinUrl                            │
│  headcount                    source (apollo/yc/ph)                  │
│  isHiring (bool)              verifiedAt                             │
│  source (yc/ph/wellfound)     createdAt                              │
│  lastEnrichedAt               updatedAt                              │
│  createdAt                                                            │
│  updatedAt                                                            │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                        PER-USER TABLES                                │
│                        (userId on every row — strict isolation)       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  users                        user_leads                             │
│  ─────                        ──────────                             │
│  id (uuid PK)                 id (uuid PK)                           │
│  email                        userId (FK → users)                    │
│  name                         companyId (FK → companies)             │
│  resumeText                   contactId (FK → contacts, nullable)    │
│  emailTemplate                status (NEW/CONTACTED/REPLIED/…)       │
│  claudeApiKey (encrypted)     addedAt                                │
│  apolloApiKey (encrypted)     notes                                  │
│  gmailRefreshToken (enc)                                             │
│  gmailEmail                   emails                                 │
│  createdAt                    ──────                                  │
│                               id (uuid PK)                           │
│                               userId (FK → users)                    │
│                               leadId (FK → user_leads)               │
│                               contactId (FK → contacts)              │
│                               subject                                │
│                               body                                   │
│                               status (DRAFT/SENT/REPLIED/…)          │
│                               messageId (unique — for reply tracking)│
│                               sentAt                                 │
│                               repliedAt (nullable)                   │
│                               followUpAt (nullable)                  │
│                               createdAt                              │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- `companies` and `contacts` have no `userId`. All users share this data. Upsert on `domain` (company) and `email` (contact) prevents duplicates.
- `user_leads` is the junction: a user "claims" a company+contact pair into their personal lead list.
- `emails.messageId` stores the outbound `Message-ID` header — IMAP polling matches `In-Reply-To` against this column.
- API keys are stored encrypted per user (AES-256 at rest). Never returned raw in API responses.

---

## Data Flow

### Lead Discovery Flow

```
User sets filters in UI
    ↓
POST /api/scrape  (enqueue job, return jobId)
    ↓
BullMQ scrape-queue (worker process)
    ↓
ScraperService: fetch YC / PH / Wellfound pages
    ↓
EnrichmentService: resolve contacts via Apollo API
    ↓
prisma.company.upsert()  →  companies table (shared)
prisma.contact.upsert()  →  contacts table (shared)
prisma.userLead.create() →  user_leads table (per-user)
    ↓
Client polls GET /api/jobs/:jobId for progress
    ↓
Lead appears in user's dashboard
```

### Email Generation and Send Flow

```
User clicks "Generate Email" for a lead
    ↓
POST /api/emails/generate
    ↓
AIService:
  1. Fetch company context (web search or stored data)
  2. Load user.resumeText + user.emailTemplate
  3. Call Claude API with assembled prompt
  4. Return generated email body
    ↓
Email saved as DRAFT in emails table
    ↓
User reviews → clicks "Send"
    ↓
POST /api/emails/:id/send
    ↓
BullMQ email-queue (worker process)
    ↓
EmailWorker:
  1. Build Nodemailer transport with user's Gmail OAuth2 token
  2. Send email with unique Message-ID header
  3. Update email status → SENT, sentAt = now()
  4. Schedule follow-up reminder: add to BullMQ delayed job
```

### Reply Detection Flow

```
BullMQ repeatable job: every 10 minutes per active user
    ↓
ReplyWorker:
  1. Connect to user's Gmail via IMAP (imapflow library)
  2. Fetch new messages in INBOX since last poll
  3. For each message: extract In-Reply-To header
  4. SELECT email WHERE messageId = inReplyTo AND userId = userId
  5. If match found: update email.status = REPLIED, email.repliedAt = now()
  6. Cancel pending follow-up job for that email
    ↓
Dashboard auto-updates on next load / polling interval
```

### Follow-Up Reminder Flow

```
Email sent → BullMQ delayed job created (delay: 5 days)
    ↓
After 5 days, no reply detected
    ↓
FollowUpWorker fires:
  1. Check if email.status is still SENT (not REPLIED)
  2. If yes: create follow-up email draft OR notify user
  3. If no: discard job (was already replied)
```

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-100 users | Monolith is fine. Single worker process. One Postgres instance (Supabase free). Redis on Upstash. No connection pooling needed beyond Prisma default. |
| 100-1k users | Add PgBouncer connection pooler (Supabase provides this). Increase worker concurrency. Add indexes on `userId`, `companyId`, `messageId`. Consider rate-limiting Apollo API calls per-user. |
| 1k-10k users | Separate worker into multiple processes by queue type. Add Postgres read replica for dashboard queries. Cache frequently-read company data in Redis. Consider per-user IMAP polling budget (not every user every 10min). |
| 10k+ users | Horizontal worker scaling. Partition `emails` table by userId range. Dedicated enrichment service. At this scale re-evaluate whether Vercel + Railway is the right deployment model. |

### Scaling Priorities

1. **First bottleneck:** IMAP polling — one IMAP connection per active user per poll cycle. At ~100 concurrent users this becomes expensive. Mitigation: batch polling windows, reduce frequency for inactive users.
2. **Second bottleneck:** Apollo API rate limits — shared global pool helps but per-user API keys mean each key has its own limit. Mitigation: queue Apollo calls, respect retry-after headers in worker.
3. **Third bottleneck:** Claude API latency — email generation is synchronous from the user's perspective. Mitigation: stream responses to the UI, generate in background and notify via polling.

---

## Suggested Build Order (Phase Dependencies)

```
Phase 1: Foundation
  Auth (NextAuth / Supabase Auth) + User model + Onboarding flow
  ↓ (everything depends on userId)

Phase 2: Data Layer
  Prisma schema (all tables) + migrations + shared DB setup
  ↓ (jobs and services depend on schema)

Phase 3: Background Infrastructure
  Redis setup + BullMQ queue definitions + worker process skeleton
  ↓ (scraping depends on queues; email sending depends on queues)

Phase 4: Lead Discovery
  Scrapers (YC first, simplest) + Apollo enrichment + shared pool upsert
  ↓ (email gen depends on having leads)

Phase 5: Email Generation
  Claude API integration + prompt engineering + draft UI
  ↓ (sending depends on drafts existing)

Phase 6: Email Sending
  Nodemailer + Gmail OAuth2 per-user + Message-ID tracking
  ↓ (reply detection depends on sent emails with Message-IDs)

Phase 7: Reply Detection + Follow-Ups
  IMAP polling worker + In-Reply-To matching + follow-up scheduler

Phase 8: Dashboard Polish
  Filters, status management, bulk actions, lead/email views
```

---

## Anti-Patterns

### Anti-Pattern 1: Running BullMQ Workers on Vercel

**What people do:** Deploy the entire app to Vercel and expect BullMQ workers to run inside API routes or Edge functions.

**Why it's wrong:** Vercel serverless functions terminate after the response is sent. Workers need a persistent process. Community reports confirm jobs run 0-2 times and then silently fail in production. This is a fundamental architectural mismatch.

**Do this instead:** Deploy the worker process to Railway, Fly.io, or a DigitalOcean droplet. Keep the Next.js app on Vercel. They share the same Redis and Postgres. API routes only enqueue jobs — workers do all the processing.

### Anti-Pattern 2: Storing Credentials in the Global Company/Contact Tables

**What people do:** Add a `userId` or `apiKey` column to `companies` or `contacts` because "that's where it's convenient."

**Why it's wrong:** Destroys the shared pool model. Each user ends up with their own copy of the same company, defeating the purpose of a shared pool and multiplying API costs.

**Do this instead:** Keep `companies` and `contacts` as truly global, anonymous records. All user-specific state goes in `user_leads` and `emails`.

### Anti-Pattern 3: Creating a New Nodemailer Transport Per Request

**What people do:** Build and throw away a Nodemailer transport on every `/api/emails/send` call.

**Why it's wrong:** OAuth2 token refresh overhead on every email. Connection setup cost. More importantly, sending from an API route means Vercel's 60s timeout applies to the email send, which can fail for slow Gmail SMTP connections.

**Do this instead:** Send emails inside a BullMQ worker. The worker process is long-lived and can handle retries, backoff, and token refresh properly.

### Anti-Pattern 4: Polling IMAP Inside a Next.js API Route

**What people do:** Create a `/api/check-replies` route that opens an IMAP connection and scans the inbox on demand.

**Why it's wrong:** IMAP connections are stateful and slow to establish. Running this synchronously in a user-facing request creates a terrible UX and hits Vercel timeouts quickly.

**Do this instead:** Use a BullMQ repeatable job in the worker process. Poll every 10 minutes per active user, update the database, let the frontend refresh on its own schedule.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Claude API (Anthropic) | REST via `@anthropic-ai/sdk`, called from `AIService` | Per-user API key stored encrypted; passed at call time. Never use a single server-side key for multi-user cost isolation. |
| Apollo API | REST, called from `EnrichmentService` in BullMQ worker | Per-user API key. Queue calls to respect rate limits. Cache results in shared `contacts` table to avoid redundant calls. |
| Gmail SMTP (send) | Nodemailer OAuth2 transport, per-user refresh token | Store `gmailRefreshToken` encrypted on `users` table. Nodemailer auto-refreshes access tokens. Build transport in worker, not API route. |
| Gmail IMAP (receive) | `imapflow` library, per-user credentials, in BullMQ worker | Poll INBOX every 10 min. Match `In-Reply-To` header against `emails.messageId`. |
| YC / Product Hunt / Wellfound | HTTP scraping (Cheerio or Playwright) in BullMQ worker | These have no official API. Rate-limit scrape jobs. Rotate user-agents. Store results in shared `companies` table. |
| Supabase (PostgreSQL) | Prisma ORM with connection pooling via Supabase's PgBouncer | Use pooled connection string in production. Use direct connection string for migrations only. |
| Upstash Redis | `ioredis` client, used by BullMQ | Upstash's serverless Redis is compatible with BullMQ. Ensure TLS is enabled. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Next.js API routes ↔ Services | Direct TypeScript function calls | Services are pure functions — no HTTP between them |
| API routes ↔ BullMQ Worker | Redis queue (via BullMQ) | The only async boundary. API route adds job; worker picks up job. |
| BullMQ Worker ↔ Services | Direct TypeScript function calls | Worker imports same services as API routes |
| BullMQ Worker ↔ Database | Prisma ORM (shared schema) | Worker uses same Prisma client, same DB |
| Worker ↔ External APIs | HTTP (Anthropic SDK, Apollo REST, Nodemailer, imapflow) | All external calls happen in workers, not API routes, to avoid Vercel timeouts |

---

## Sources

- BullMQ official docs — architecture: https://docs.bullmq.io/guide/architecture
- Vercel community thread — BullMQ workers not running on Vercel: https://community.vercel.com/t/issues-with-bullmq-worker-not-running-in-vercel-production-environment/687/2
- Next.js official — Backend for Frontend pattern: https://nextjs.org/docs/app/guides/backend-for-frontend
- Next.js official — Building APIs: https://nextjs.org/blog/building-apis-with-nextjs
- Nodemailer official — OAuth2: https://nodemailer.com/smtp/oauth2
- Nodemailer official — Using Gmail: https://nodemailer.com/usage/using-gmail
- EmailEngine — Reply tracking via IMAP: https://docs.emailengine.app/tracking-email-replies-with-imap-api/
- Crunchy Data — Designing Postgres for multi-tenancy: https://www.crunchydata.com/blog/designing-your-postgres-database-for-multi-tenancy
- AWS — Multi-tenant data isolation with PostgreSQL RLS: https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/

---

*Architecture research for: Cold Email Automation SaaS*
*Researched: 2026-03-15*
