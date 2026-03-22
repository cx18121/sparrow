# Phase 2: Discovery - Research

**Researched:** 2026-03-21
**Domain:** Data ingestion pipeline — Prisma schema design, web scraping, external API integration, idempotent upserts
**Confidence:** HIGH (stack fixed, sources verified against official docs and GitHub)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISC-01 | App pulls companies from YC, Wellfound, and Product Hunt into shared global pool via background jobs | YC public JSON API (HIGH), Wellfound via `__NEXT_DATA__` extraction + stealth (MEDIUM), Product Hunt GraphQL V2 (HIGH) |
| DISC-02 | App enriches contacts with emails via user's Apollo API key | Apollo People Enrichment REST endpoint; per-user key injected at call time (HIGH) |
| DISC-03 | User can filter the lead pool by company size, funding stage, location, industry, is-hiring, and contact role | Prisma schema field selection — all filter fields must be indexed columns (HIGH) |
| DISC-04 | Location filtering groups nearby cities into named regions (e.g. "Bay Area" = SF + San Jose) | Static lookup table or `region` column on `companies`; populated during ingest (HIGH) |
| DISC-05 | User can manually add a company and contact to their lead list | Manual insert path through same upsert service; source tagged `"manual"` (HIGH) |
| LEAD-01 | User can view all leads in a filterable, searchable dashboard | Prisma query with `where` filters + full-text search index (Phase 3 UI; schema must support it) |
| LEAD-02 | User can save leads to their personal list from the global pool | `user_leads` junction table — FK to `companies` + `contacts`, scoped by `userId` (HIGH) |
| LEAD-03 | User can tag leads with status: New / Saved / Emailed / Rejected | `status` enum on `user_leads` (HIGH) |
| LEAD-04 | User can bulk-select leads and trigger batch email generation | Batch query by `userId` + status filter; returns array of `userLeadId` values (HIGH) |
</phase_requirements>

---

## Summary

This phase's in-scope deliverable is two things only: (1) a complete Prisma schema for the shared company/contact pool with all filter fields, and (2) standalone TypeScript scraper scripts for each data source. No BullMQ workers, no frontend UI, no auth integration.

The schema must be designed so that every filter field required by DISC-03 and DISC-04 is a first-class indexed column, not a JSON blob. The `last_verified_at` pattern (a timestamp on the `contacts` table, set on every successful enrichment) is the correct mechanism for tracking data freshness and driving re-enrichment logic. Idempotent upserts are achieved via Prisma's `upsert()` with `@@unique` constraints — Prisma emits native PostgreSQL `INSERT ... ON CONFLICT DO UPDATE` for these, which is atomic and race-condition safe.

YC data is the most reliable source: a public GitHub-hosted JSON API updated daily via GitHub Actions, covering 5,690+ companies with all required filter fields. Product Hunt has an official GraphQL V2 API but prohibits commercial use without contacting them — treat as aspirational until approved. Wellfound is the highest-risk source: it uses Cloudflare anti-bot protections and is "notorious for blocking all scrapers." The recommended approach is extracting `__NEXT_DATA__` embedded JSON (no rendered DOM parsing needed) combined with ScrapFly or playwright-extra stealth — but a spike is required before committing.

**Primary recommendation:** Build schema + YC ingestion first. Add Apollo enrichment second. Treat Wellfound as a spike with a clear fallback (skip it for v1 if the spike fails within a time-box). Treat Product Hunt as low-priority until API approval is confirmed.

---

## Standard Stack

### Core (already decided — do not change)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `prisma` | 7.5.0 | Schema definition, migrations, client generation | Stack mandated; pure TypeScript client in v7, no Rust binary |
| `@prisma/client` | 7.5.0 | Generated type-safe DB client | Paired with `prisma` — always same version |
| `axios` | 1.13.6 | HTTP client for Apollo REST API + Product Hunt GraphQL | Stack research confirmed; no official Node Apollo SDK exists |
| `playwright` | 1.58.2 | Browser-based scraping for Wellfound (Cloudflare-protected SPA) | Stack mandated; auto-wait, stealth plugins available |
| `cheerio` | 1.2.0 | HTML parsing for static/SSR pages | Lightweight; use when `__NEXT_DATA__` extraction is sufficient |

### Supporting (this phase)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `playwright-extra` | ^4.x | Playwright with stealth plugin support | Wellfound scraping — adds stealth patches over stock Playwright |
| `puppeteer-extra-plugin-stealth` | ^2.x | Anti-detect fingerprint patches | Required with `playwright-extra` for Cloudflare bypass |
| `tsx` | ^4.x | Run TypeScript scraper scripts directly | Scripts run standalone (`tsx scripts/ingest-yc.ts`), outside Next.js |
| `dotenv` | ^16.x | Load `.env` in standalone scripts | Scripts don't inherit Next.js env loading |
| `graphql-request` | ^7.x | Minimal GraphQL client for Product Hunt API | Lighter than Apollo Client for simple queries; or use plain `axios` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `playwright-extra` stealth | ScrapFly / Apify managed scraping | Managed services cost $20-50/month but eliminate stealth maintenance; good fallback if Wellfound blocks persist |
| `graphql-request` for Product Hunt | `axios` POST with raw GraphQL body | `axios` is already in stack; perfectly valid to skip `graphql-request` |
| `tsx` for scripts | `ts-node` | `tsx` is faster (uses esbuild); `ts-node` is older but widely used |

**Installation (this phase additions):**

```bash
npm install playwright-extra puppeteer-extra-plugin-stealth graphql-request
npm install -D tsx dotenv
```

**Version verification (confirmed 2026-03-21):**
- `prisma`: 7.5.0 (npm registry)
- `@prisma/client`: 7.5.0 (npm registry)
- `playwright`: 1.58.2 (npm registry)
- `cheerio`: 1.2.0 (npm registry)
- `axios`: 1.13.6 (npm registry)

---

## Architecture Patterns

### Recommended Project Structure (this phase)

```
prisma/
└── schema.prisma              # Complete schema — companies, contacts, user_leads, users

scripts/
├── ingest-yc.ts               # YC ingestion — fetch all.json, upsert companies
├── ingest-producthunt.ts      # Product Hunt GraphQL — fetch recent posts, upsert companies
├── ingest-wellfound.ts        # Wellfound spike — __NEXT_DATA__ extraction
├── enrich-apollo.ts           # Apollo People Enrichment — per company, writes contacts
└── _lib/
    ├── prisma.ts              # Prisma singleton
    ├── apollo-client.ts       # Apollo API wrapper (accepts apiKey param)
    ├── region-map.ts          # City → region lookup table
    └── upsert.ts              # Shared idempotent upsert helpers
```

### Pattern 1: Prisma Schema — Shared Pool Tables

**What:** `companies` and `contacts` have no `userId`. Every scraper writes to these shared tables. Per-user state lives in `user_leads`.

**When to use:** Always — this is the core data model decision already locked.

**Critical fields for DISC-03 filters (must be columns, not JSON):**

```prisma
// Source: Architecture from .planning/research/ARCHITECTURE.md (HIGH confidence)
model Company {
  id             String    @id @default(cuid())
  name           String
  domain         String    @unique                // upsert key
  description    String?
  oneLiner       String?
  website        String?
  stage          String?   // "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Series C+" | "Public"
  industry       String?   // e.g. "B2B Software", "Healthcare", "Fintech"
  subIndustry    String?
  location       String?   // raw string from source
  region         String?   // normalized: "Bay Area" | "New York" | "Remote" | etc.
  headcount      Int?      // team_size from YC
  isHiring       Boolean   @default(false)
  batch          String?   // YC-specific: "W24", "S23", etc.
  source         String    // "yc" | "producthunt" | "wellfound" | "manual"
  sourceId       String?   // source-native ID for deduplication
  lastScrapedAt  DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  contacts       Contact[]
  userLeads      UserLead[]

  @@index([stage])
  @@index([industry])
  @@index([region])
  @@index([isHiring])
  @@index([source])
}

model Contact {
  id              String    @id @default(cuid())
  companyId       String
  company         Company   @relation(fields: [companyId], references: [id])
  name            String?
  email           String?   @unique            // upsert key
  title           String?   // "CTO" | "Founder" | "Head of Engineering"
  role            String?   // normalized role: "technical" | "founder" | "other"
  linkedinUrl     String?
  source          String    // "apollo" | "yc" | "manual"
  lastVerifiedAt  DateTime? // set on each successful Apollo enrichment
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  userLeads       UserLead[]
  emails          Email[]

  @@index([companyId])
  @@index([role])
  @@index([lastVerifiedAt])
}

model UserLead {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  companyId   String
  company     Company   @relation(fields: [companyId], references: [id])
  contactId   String?
  contact     Contact?  @relation(fields: [contactId], references: [id])
  status      LeadStatus @default(NEW)
  notes       String?
  addedAt     DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  emails      Email[]

  @@unique([userId, companyId, contactId])  // prevent duplicate user-lead pairs
  @@index([userId])
  @@index([status])
}

enum LeadStatus {
  NEW
  SAVED
  EMAILED
  REJECTED
}
```

### Pattern 2: Idempotent Upsert

**What:** Use Prisma `upsert()` on the `domain` field (companies) or `email` field (contacts). Prisma emits `INSERT ... ON CONFLICT DO UPDATE` for PostgreSQL — atomically safe.

**When to use:** Every scraper write. Re-running the script twice must produce the same DB state.

**Example:**

```typescript
// Source: Prisma official docs — https://www.prisma.io/docs/orm/prisma-client/queries/crud
// HIGH confidence — Prisma uses native PostgreSQL ON CONFLICT for upsert

async function upsertCompany(data: CompanyInput) {
  return prisma.company.upsert({
    where: { domain: data.domain },
    update: {
      name: data.name,
      stage: data.stage,
      industry: data.industry,
      isHiring: data.isHiring,
      headcount: data.headcount,
      region: normalizeRegion(data.location),
      lastScrapedAt: new Date(),
    },
    create: {
      domain: data.domain,
      name: data.name,
      stage: data.stage,
      industry: data.industry,
      location: data.location,
      region: normalizeRegion(data.location),
      isHiring: data.isHiring,
      headcount: data.headcount,
      source: data.source,
      sourceId: data.sourceId,
      lastScrapedAt: new Date(),
    },
  });
}

async function upsertContact(data: ContactInput) {
  // Contact requires email to be present — skip if no email
  if (!data.email) return null;

  return prisma.contact.upsert({
    where: { email: data.email },
    update: {
      name: data.name,
      title: data.title,
      role: normalizeRole(data.title),
      lastVerifiedAt: new Date(),
    },
    create: {
      companyId: data.companyId,
      email: data.email,
      name: data.name,
      title: data.title,
      role: normalizeRole(data.title),
      source: data.source,
      lastVerifiedAt: new Date(),
    },
  });
}
```

**Race condition note:** Prisma's PostgreSQL `upsert()` uses `ON CONFLICT DO UPDATE` which is atomic at the DB level. Concurrent ingestion runs for the same domain/email are safe. The P2002 error (unique constraint violation) can still occur for simultaneous _create_ attempts on fields without a `@@unique` constraint — only the `where` field is protected. Ensure `domain` on companies and `email` on contacts are the only upsert keys.

### Pattern 3: YC Ingestion — Direct JSON API

**What:** Fetch `https://yc-oss.github.io/api/companies/all.json` (updated daily via GitHub Actions, 5,690+ companies). Parse the array and upsert each record.

**When to use:** YC scraper script. No browser required — plain `axios.get()`.

**Available fields from yc-oss API (verified 2026-03-21):**

| YC Field | Maps To | Notes |
|----------|---------|-------|
| `name` | `company.name` | |
| `website` | Used to extract `domain` | Parse with `new URL(website).hostname` |
| `all_locations` | `company.location` | Raw string e.g. "San Francisco, CA, USA" |
| `team_size` | `company.headcount` | Integer |
| `industry` | `company.industry` | |
| `subindustry` | `company.subIndustry` | |
| `stage` | `company.stage` | "Early" / "Growth" — map to standard stages |
| `isHiring` | `company.isHiring` | Boolean |
| `batch` | `company.batch` | "W24", "S23", etc. |
| `status` | Filter out `Inactive`/`Acquired` | Only ingest `Active` companies |
| `one_liner` | `company.oneLiner` | |
| `long_description` | `company.description` | |
| `slug` | `company.sourceId` | Stable YC identifier |

**Example:**

```typescript
// Source: yc-oss API — https://yc-oss.github.io/api/companies/all.json (HIGH confidence)
import axios from "axios";

const YC_API_URL = "https://yc-oss.github.io/api/companies/all.json";

async function ingestYC() {
  const { data: companies } = await axios.get<YCCompany[]>(YC_API_URL);
  const active = companies.filter((c) => c.status === "Active" && c.website);

  for (const company of active) {
    const domain = extractDomain(company.website);
    if (!domain) continue;

    await upsertCompany({
      domain,
      name: company.name,
      description: company.long_description,
      oneLiner: company.one_liner,
      website: company.website,
      stage: mapYCStage(company.stage),
      industry: company.industry,
      subIndustry: company.subindustry,
      location: company.all_locations,
      headcount: company.team_size,
      isHiring: company.isHiring,
      batch: company.batch,
      source: "yc",
      sourceId: company.slug,
    });
  }
}
```

### Pattern 4: Apollo Contact Enrichment — Per-User Key Injection

**What:** Apollo's `/v1/people/search` and `/v1/people/match` (enrichment) endpoints are called with the user's own API key. The key is passed as a request header or query param — it is NOT stored as a global server env var.

**When to use:** After companies are ingested, run enrichment to find contacts for each company. The scraper script accepts an API key argument.

**Why per-user key model:** Apollo rate limits and credits are per-account. Sharing a single server-side key would exhaust credits fast in a multi-user product. Each user's key is stored encrypted in their `users` record during onboarding; the scraper is passed the key at runtime.

**Key Apollo endpoints (verified against official docs):**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /v1/people/search` | Requires API key | Search for people at a company; does NOT consume credits |
| `POST /v1/people/match` | Requires API key | Enrich a specific person by email/name+domain; consumes credits |
| `POST /v1/people/bulk_match` | Requires API key | Batch enrichment; 50% rate limit of `/people/match` |
| `GET /v1/auth/health` | Requires API key | Check key validity before running enrichment |

**Rate limits (confirmed from Apollo docs):**
- Free plan: 50 requests/min, 600 daily
- Basic/Pro: 200 requests/min, 2000 daily
- Enrichment (`/people/match`): credits consumed per call; exact cost is plan-gated but estimated 1 credit/match

**Example:**

```typescript
// Source: Apollo docs — https://docs.apollo.io/reference/people-api-search (HIGH confidence)
import axios from "axios";

async function searchContactsForCompany(domain: string, apiKey: string) {
  const response = await axios.post(
    "https://api.apollo.io/v1/people/search",
    {
      q_organization_domains: [domain],
      person_titles: ["CTO", "Founder", "Co-Founder", "Head of Engineering", "VP Engineering"],
      per_page: 10,
    },
    {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data.people as ApolloPersonResult[];
}

async function enrichContact(email: string, name: string, domain: string, apiKey: string) {
  const response = await axios.post(
    "https://api.apollo.io/v1/people/match",
    { email, name, domain },
    { headers: { "X-Api-Key": apiKey } }
  );
  return response.data.person;
}
```

### Pattern 5: Product Hunt GraphQL V2

**What:** Official GraphQL API at `https://api.producthunt.com/v2/api/graphql`. Requires OAuth2 client credentials for a Bearer token. Public scope only (no user login required). Query the `posts` collection filtered by topic and date.

**Important constraint:** Product Hunt explicitly states "the API must not be used for commercial purposes without contacting them." For a student club project this may be fine, but the plan should note that API approval from hello@producthunt.com is needed before deployment.

**Example:**

```typescript
// Source: Product Hunt API docs — https://api.producthunt.com/v2/docs (HIGH confidence)
import axios from "axios";

const PH_GRAPHQL_URL = "https://api.producthunt.com/v2/api/graphql";

const RECENT_POSTS_QUERY = `
  query RecentPosts($after: String) {
    posts(first: 20, after: $after, order: NEWEST) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          tagline
          website
          topics { edges { node { name } } }
          thumbnail { url }
          votesCount
          createdAt
        }
      }
    }
  }
`;

async function fetchProductHuntPosts(bearerToken: string, cursor?: string) {
  const { data } = await axios.post(
    PH_GRAPHQL_URL,
    { query: RECENT_POSTS_QUERY, variables: { after: cursor } },
    { headers: { Authorization: `Bearer ${bearerToken}` } }
  );
  return data.data.posts;
}
```

### Pattern 6: Region Normalization

**What:** A static lookup map in `scripts/_lib/region-map.ts` converts raw city strings to named regions. Applied during ingestion, stored in `company.region`.

**Why important:** DISC-04 requires region grouping. This must happen at write time (not query time) so filters remain indexed.

**Example:**

```typescript
// Custom — no library needed (HIGH confidence pattern)
const REGION_MAP: Record<string, string> = {
  "san francisco": "Bay Area",
  "sf": "Bay Area",
  "san jose": "Bay Area",
  "palo alto": "Bay Area",
  "mountain view": "Bay Area",
  "new york": "New York",
  "nyc": "New York",
  "brooklyn": "New York",
  "seattle": "Pacific Northwest",
  "bellevue": "Pacific Northwest",
  "boston": "Boston / Cambridge",
  "cambridge": "Boston / Cambridge",
  "austin": "Austin",
  "los angeles": "Los Angeles",
  "la": "Los Angeles",
  "chicago": "Chicago",
  "london": "London",
  "berlin": "Berlin",
  "remote": "Remote",
};

export function normalizeRegion(rawLocation: string | null): string | null {
  if (!rawLocation) return null;
  const lower = rawLocation.toLowerCase();
  for (const [key, region] of Object.entries(REGION_MAP)) {
    if (lower.includes(key)) return region;
  }
  return rawLocation; // keep raw if no match — planner can expand the map
}
```

### Anti-Patterns to Avoid

- **Storing filter fields in JSON columns:** Never put `industry`, `stage`, `region` into a `metadata JSON` field. Postgres can index JSONB but it's slower and less type-safe. All filter fields must be named columns with explicit indexes.
- **Global Apollo API key:** Never store one Apollo key server-side for all users. This shares rate limits, exhausts credits, and breaks the per-user billing model.
- **Upsert key on mutable fields:** Never use `name` as the upsert key for companies — names change. `domain` is stable and unique. For contacts, `email` is the only stable key.
- **Scraping inside API routes:** Scrapers are long-running (minutes). They must run as standalone scripts or BullMQ workers — not in Next.js route handlers.
- **Running Wellfound scraper without a spike:** Do not schedule Wellfound as a reliable data source until the stealth approach is validated in isolation.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YC company data | Custom YC website scraper | `yc-oss/api` JSON endpoint | Already scraped daily, 5,690+ companies, all required fields |
| Idempotent insert | Custom `SELECT then INSERT` logic | `prisma.company.upsert()` | Prisma emits atomic `ON CONFLICT DO UPDATE`; hand-rolled version has race conditions |
| Region grouping | ML/NLP city classification | Static lookup map in `region-map.ts` | Startup hubs are well-known and finite; a 20-entry map covers 80%+ of YC companies |
| Apollo HTTP calls | Custom retry/backoff logic | `axios` with `axios-retry` | Handles 429 rate limit responses with exponential backoff; do not reinvent |
| Cloudflare bypass | Custom TLS fingerprinting | `playwright-extra` + stealth plugin, or ScrapFly | TLS fingerprinting changes frequently; stealth plugins are maintained by a community |

**Key insight:** The YC open API is a force multiplier — a plain HTTP GET returns a structured JSON array with all required filter fields. Start here before writing any browser automation code.

---

## Common Pitfalls

### Pitfall 1: Wellfound Blocking Your Scraper

**What goes wrong:** Playwright with default settings hits Cloudflare and receives a 403 or CAPTCHA page. The scraper silently stores zero records or crashes.

**Why it happens:** Wellfound uses Cloudflare Bot Management which detects headless Chrome via `navigator.webdriver`, TLS fingerprint, and canvas fingerprint divergence from real browsers.

**How to avoid:**
1. Spike with `playwright-extra` + `puppeteer-extra-plugin-stealth` before committing to Wellfound as a data source.
2. Add randomized delays between requests (500ms–2000ms jitter).
3. Extract `__NEXT_DATA__` from the page HTML instead of DOM scraping — it avoids re-rendering and reduces request volume.
4. Have a fallback plan: if the spike fails, skip Wellfound for v1.

**Warning signs:** HTTP 403, CAPTCHA pages, empty `__NEXT_DATA__`, or Cloudflare challenge HTML in the response body.

### Pitfall 2: Missing `domain` on Company Records

**What goes wrong:** A company has no `website` field (common for very early YC companies or Product Hunt posts without a live site). The upsert key `domain` is null, causing a constraint violation or creating duplicate records under different null keys.

**Why it happens:** `domain` is marked `@unique` in the schema — null is not unique in Postgres (two null values do not conflict), but Prisma's `upsert()` requires a non-null `where` value.

**How to avoid:** Skip companies with no `website`. Add a guard at the top of the ingestion loop: `if (!data.website) continue;`. Log skipped count for visibility.

**Warning signs:** P2002 unique constraint errors in the scraper logs, or duplicate company rows with null domains.

### Pitfall 3: Apollo Credits Exhausted Before Contacts Are Written

**What goes wrong:** The enrichment script runs, consumes all credits, then crashes or is interrupted. No contacts are written. Re-running the script consumes credits again for companies that were already processed.

**Why it happens:** Apollo credits are consumed at the API call, not at DB write time. A crash between call and write wastes credits.

**How to avoid:**
1. Write the contact record to DB immediately after each successful Apollo response — don't batch.
2. Set `lastVerifiedAt` on successful write. Re-enrichment logic: `WHERE lastVerifiedAt IS NULL OR lastVerifiedAt < NOW() - INTERVAL '30 days'`.
3. Implement a dry-run mode that fetches Apollo data but does not write — useful for testing without burning credits.

**Warning signs:** Apollo 402 (payment required) or 429 (rate limited) responses.

### Pitfall 4: Product Hunt API Commercial Use Block

**What goes wrong:** The scraper runs in production, Product Hunt detects commercial use, and the API token is revoked.

**Why it happens:** Product Hunt's terms explicitly state the API "must not be used for commercial purposes" without prior approval.

**How to avoid:** Contact hello@producthunt.com before using in production. For development/testing, client credentials work without approval. Mark this as a pre-launch gate in the plan.

**Warning signs:** 401 Unauthorized with a message about terms of service.

### Pitfall 5: `UserLead` Duplicate Creation

**What goes wrong:** A user saves the same company twice, creating two `user_leads` rows with the same `(userId, companyId, contactId)`.

**Why it happens:** The save-lead endpoint doesn't check for existing rows before inserting.

**How to avoid:** The `@@unique([userId, companyId, contactId])` constraint on `UserLead` prevents this at the DB level. Use `upsert()` or catch P2002 at the service layer.

**Warning signs:** P2002 errors when a user clicks "Save" twice rapidly.

### Pitfall 6: `last_verified_at` vs `updatedAt` Confusion

**What goes wrong:** Engineers use `updatedAt` to decide if a contact needs re-enrichment, but `updatedAt` is set on any field change — including unrelated updates.

**Why it happens:** Prisma's `@updatedAt` auto-updates on any `update` call.

**How to avoid:** Use a dedicated `lastVerifiedAt` column on `contacts` that is only set during a successful Apollo enrichment call. This clearly separates "enrichment freshness" from "record modified time."

---

## Code Examples

Verified patterns from official sources:

### Complete Prisma Schema (all filter fields)

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

model Company {
  id            String    @id @default(cuid())
  name          String
  domain        String    @unique
  description   String?
  oneLiner      String?
  website       String?
  stage         String?   // "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Growth" | "Public"
  industry      String?
  subIndustry   String?
  location      String?   // raw location string from source
  region        String?   // normalized: "Bay Area" | "New York" | "Remote" | etc.
  headcount     Int?
  isHiring      Boolean   @default(false)
  batch         String?   // YC batch: "W24", "S23"
  source        String    // "yc" | "producthunt" | "wellfound" | "manual"
  sourceId      String?
  lastScrapedAt DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  contacts  Contact[]
  userLeads UserLead[]

  @@index([stage])
  @@index([industry])
  @@index([region])
  @@index([isHiring])
}

model Contact {
  id             String    @id @default(cuid())
  companyId      String
  company        Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  name           String?
  email          String?   @unique
  title          String?
  role           String?   // "technical" | "founder" | "business" | "other"
  linkedinUrl    String?
  source         String    // "apollo" | "yc" | "manual"
  lastVerifiedAt DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  userLeads UserLead[]
  emails    Email[]

  @@index([companyId])
  @@index([role])
  @@index([lastVerifiedAt])
}

model User {
  id                String    @id @default(cuid())
  email             String    @unique
  name              String?
  resumeText        String?
  emailTemplate     String?
  claudeApiKey      String?   // AES-256 encrypted at rest
  apolloApiKey      String?   // AES-256 encrypted at rest
  gmailRefreshToken String?   // encrypted
  gmailEmail        String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  userLeads UserLead[]
  emails    Email[]
}

model UserLead {
  id        String     @id @default(cuid())
  userId    String
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  companyId String
  company   Company    @relation(fields: [companyId], references: [id])
  contactId String?
  contact   Contact?   @relation(fields: [contactId], references: [id])
  status    LeadStatus @default(NEW)
  notes     String?
  addedAt   DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  emails Email[]

  @@unique([userId, companyId, contactId])
  @@index([userId])
  @@index([userId, status])
}

model Email {
  id          String      @id @default(cuid())
  userId      String
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  userLeadId  String?
  userLead    UserLead?   @relation(fields: [userLeadId], references: [id])
  contactId   String?
  contact     Contact?    @relation(fields: [contactId], references: [id])
  subject     String?
  body        String?
  status      EmailStatus @default(DRAFT)
  messageId   String?     @unique  // outbound Message-ID header; used for reply detection
  sentAt      DateTime?
  repliedAt   DateTime?
  followUpAt  DateTime?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([userId])
  @@index([userId, status])
  @@index([messageId])
}

enum LeadStatus {
  NEW
  SAVED
  EMAILED
  REJECTED
}

enum EmailStatus {
  DRAFT
  SENT
  REPLIED
  INTERESTED
  REJECTED
}
```

### YC Ingest Script Skeleton

```typescript
// scripts/ingest-yc.ts
// Source: yc-oss/api — https://yc-oss.github.io/api/companies/all.json (HIGH confidence)
import axios from "axios";
import { prisma } from "./_lib/prisma";
import { normalizeRegion } from "./_lib/region-map";

const YC_API = "https://yc-oss.github.io/api/companies/all.json";

function extractDomain(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace("www.", "");
  } catch {
    return null;
  }
}

function mapStage(ycStage: string): string {
  if (ycStage === "Early") return "Seed";
  if (ycStage === "Growth") return "Series A+";
  return ycStage ?? "Unknown";
}

async function main() {
  const { data } = await axios.get<YCCompany[]>(YC_API);
  const active = data.filter((c) => c.status === "Active" && c.website);

  console.log(`Ingesting ${active.length} active YC companies...`);
  let upserted = 0;

  for (const company of active) {
    const domain = extractDomain(company.website);
    if (!domain) continue;

    await prisma.company.upsert({
      where: { domain },
      update: {
        name: company.name,
        stage: mapStage(company.stage),
        industry: company.industry,
        isHiring: company.isHiring ?? false,
        headcount: company.team_size,
        region: normalizeRegion(company.all_locations),
        lastScrapedAt: new Date(),
      },
      create: {
        domain,
        name: company.name,
        description: company.long_description,
        oneLiner: company.one_liner,
        website: company.website,
        stage: mapStage(company.stage),
        industry: company.industry,
        subIndustry: company.subindustry,
        location: company.all_locations,
        region: normalizeRegion(company.all_locations),
        isHiring: company.isHiring ?? false,
        headcount: company.team_size,
        batch: company.batch,
        source: "yc",
        sourceId: company.slug,
        lastScrapedAt: new Date(),
      },
    });
    upserted++;
  }

  console.log(`Done. Upserted ${upserted} companies.`);
  await prisma.$disconnect();
}

main().catch(console.error);
```

### Apollo Enrichment Script Skeleton

```typescript
// scripts/enrich-apollo.ts
import axios from "axios";
import { prisma } from "./_lib/prisma";

const APOLLO_SEARCH_URL = "https://api.apollo.io/v1/people/search";
const TARGET_TITLES = ["CTO", "Founder", "Co-Founder", "Head of Engineering", "VP Engineering", "CEO"];

async function enrichCompany(domain: string, companyId: string, apiKey: string) {
  const response = await axios.post(
    APOLLO_SEARCH_URL,
    {
      q_organization_domains: [domain],
      person_titles: TARGET_TITLES,
      per_page: 5,
    },
    { headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" } }
  );

  const people: ApolloPersonResult[] = response.data.people ?? [];

  for (const person of people) {
    if (!person.email) continue;

    await prisma.contact.upsert({
      where: { email: person.email },
      update: {
        name: person.name,
        title: person.title,
        role: normalizeRole(person.title),
        lastVerifiedAt: new Date(),
      },
      create: {
        companyId,
        email: person.email,
        name: person.name,
        title: person.title,
        role: normalizeRole(person.title),
        linkedinUrl: person.linkedin_url,
        source: "apollo",
        lastVerifiedAt: new Date(),
      },
    });
  }
}

async function main() {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new Error("APOLLO_API_KEY env var required");

  // Only enrich companies that have never been enriched or are stale (30+ days)
  const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const companies = await prisma.company.findMany({
    where: {
      contacts: {
        none: { lastVerifiedAt: { gt: staleDate } },
      },
    },
    take: 100, // batch size — respect rate limits
  });

  for (const company of companies) {
    if (!company.domain) continue;
    await enrichCompany(company.domain, company.id, apiKey);
    await new Promise((r) => setTimeout(r, 300)); // respect rate limits
  }
}
```

### `last_verified_at` Re-enrichment Query

```typescript
// Query companies whose contacts are stale or missing
// Source: Prisma docs patterns (HIGH confidence)
const STALE_THRESHOLD_DAYS = 30;

const companiesNeedingEnrichment = await prisma.company.findMany({
  where: {
    OR: [
      { contacts: { none: {} } },                              // no contacts yet
      {
        contacts: {
          every: {
            lastVerifiedAt: {
              lt: new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000),
            },
          },
        },
      },
    ],
  },
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Scrape YC website directly with Playwright | Fetch `yc-oss/api` JSON (GitHub-hosted, daily-updated) | 2022 onwards | No browser automation needed for YC; plain HTTP GET |
| Wellfound DOM scraping | Extract `__NEXT_DATA__` embedded JSON | 2023+ | Less fragile than CSS selectors; still requires bypassing Cloudflare |
| `node-fetch` for HTTP | `axios` | N/A for this stack | Axios has interceptors, better error types; stack already confirmed |
| Prisma 5 (Rust WASM binary) | Prisma 7 (pure TypeScript client) | 2025 | Faster cold starts; current npm version is 7.5.0 |
| Single server Apollo key | Per-user API key injection | Design decision | Respects Apollo's credit model; avoids shared rate limit exhaustion |

**Deprecated/outdated:**
- `bull` (npm): unmaintained since 2021. Use `bullmq` (but bullmq is out of scope for this phase).
- `axios@0.x`: Old version with different interceptor API. Use `axios@1.x` (currently 1.13.6).
- Scraping YC with Playwright + DOM selectors: yc-oss/api makes this unnecessary.

---

## Open Questions

1. **Wellfound Feasibility**
   - What we know: Wellfound uses Cloudflare anti-bot; `playwright-extra` stealth exists; ScrapFly can bypass it for ~$20/month; `__NEXT_DATA__` extraction avoids DOM parsing
   - What's unclear: Whether `playwright-extra` + stealth reliably bypasses Wellfound's current Cloudflare config as of 2026. This has historically broken without warning when CF updates its detection.
   - Recommendation: Time-box a 2-hour spike. If stealth works: implement. If blocked: skip Wellfound for v1 and rely on YC + Product Hunt. Document the decision in STATE.md.

2. **Product Hunt Commercial Use Approval**
   - What we know: API requires contacting hello@producthunt.com for commercial use; client credentials OAuth works for development
   - What's unclear: Whether this project qualifies as "commercial" (it's a student club project)
   - Recommendation: Email Product Hunt for approval before deploying ingest to production. Use in dev freely. Add a comment in the ingest script noting the requirement.

3. **Apollo Credit Cost Per Enrichment**
   - What we know: Credits are consumed per `/v1/people/match` call; `/v1/people/search` does NOT consume credits; free plan = 600 credits/day; paid basic = 2000/day
   - What's unclear: Exact per-call credit cost for `/people/match` (login-gated in Apollo docs)
   - Recommendation: Use `/v1/people/search` (free) first to discover contacts, and only call `/v1/people/match` for enrichment when email is not returned by search. This maximizes data quality per credit spent.

4. **Stage Field Normalization**
   - What we know: YC uses "Early" / "Growth"; Product Hunt has no stage field; Apollo returns funding stage on organization enrichment
   - What's unclear: Best canonical set of stage values for the filter UI
   - Recommendation: Use: `"Pre-Seed" | "Seed" | "Series A" | "Series B" | "Series C+" | "Growth" | "Public" | "Unknown"`. Map YC "Early" → "Seed", YC "Growth" → "Series A+", Apollo org stage → direct mapping.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (planned per STACK.md) |
| Config file | `vitest.config.ts` — does not yet exist (Wave 0 gap) |
| Quick run command | `npx vitest run scripts/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISC-01 (YC) | YC ingest produces correct company shape | unit | `npx vitest run scripts/__tests__/ingest-yc.test.ts` | Wave 0 |
| DISC-01 (PH) | Product Hunt ingest maps GraphQL response to company | unit | `npx vitest run scripts/__tests__/ingest-ph.test.ts` | Wave 0 |
| DISC-02 | Apollo enrichment writes contact with `lastVerifiedAt` | unit | `npx vitest run scripts/__tests__/enrich-apollo.test.ts` | Wave 0 |
| DISC-03 | All filter fields are present as indexed columns | schema check | `npx prisma validate` | Wave 0 |
| DISC-04 | `normalizeRegion("San Francisco, CA")` returns "Bay Area" | unit | `npx vitest run scripts/__tests__/region-map.test.ts` | Wave 0 |
| DISC-05 | Manual company insert via upsert service | unit | `npx vitest run scripts/__tests__/upsert.test.ts` | Wave 0 |
| LEAD-02 | `UserLead` upsert prevents duplicates on `@@unique` | unit | included in `upsert.test.ts` | Wave 0 |
| LEAD-03 | `LeadStatus` enum values match schema | schema check | `npx prisma validate` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run scripts/__tests__/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `vitest.config.ts` — framework config
- [ ] `scripts/__tests__/ingest-yc.test.ts` — unit tests for YC field mapping + domain extraction
- [ ] `scripts/__tests__/ingest-ph.test.ts` — unit tests for Product Hunt GraphQL response mapping
- [ ] `scripts/__tests__/enrich-apollo.test.ts` — mocked Apollo responses, verifies DB write shape
- [ ] `scripts/__tests__/region-map.test.ts` — covers known city strings + edge cases
- [ ] `scripts/__tests__/upsert.test.ts` — idempotency tests (run same data twice, verify single row)
- [ ] Framework install: `npm install -D vitest` (not yet in `package.json`)

---

## Sources

### Primary (HIGH confidence)

- yc-oss/api GitHub — endpoint list, field schema, update frequency: https://github.com/yc-oss/api
- yc-oss all.json endpoint — live field verification: https://yc-oss.github.io/api/companies/all.json
- Apollo People Enrichment endpoint: https://docs.apollo.io/reference/people-enrichment
- Apollo People Search endpoint: https://docs.apollo.io/reference/people-api-search
- Apollo Rate Limits: https://docs.apollo.io/reference/rate-limits
- Apollo API Pricing: https://docs.apollo.io/docs/api-pricing
- Product Hunt API V2 docs: https://api.producthunt.com/v2/docs
- Prisma upsert / ON CONFLICT: https://www.prisma.io/docs/orm/prisma-client/queries/crud
- Prisma compound unique constraints: https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-composite-ids-and-constraints
- Prisma Supabase connection setup: https://supabase.com/docs/guides/database/prisma
- Project STACK.md / ARCHITECTURE.md (.planning/research/) — confirmed stack, schema sketch

### Secondary (MEDIUM confidence)

- Wellfound `__NEXT_DATA__` extraction approach (ScrapFly guide, updated Sept 2025): https://scrapfly.io/blog/posts/how-to-scrape-wellfound-aka-angellist
- Apollo free tier rate limits (600/day, 50/min): confirmed across multiple third-party sources

### Tertiary (LOW confidence — flag for validation)

- Exact Apollo credit cost per `/people/match` call — login-gated, unconfirmed from public docs
- Wellfound stealth bypass success rate in 2026 — evolving target; spike required

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — prisma 7.5.0, playwright 1.58.2, axios 1.13.6 confirmed via npm registry 2026-03-21
- YC ingestion: HIGH — public JSON API verified live, field schema documented
- Apollo integration: HIGH (endpoint structure) / LOW (exact credit cost per call — login-gated)
- Wellfound feasibility: MEDIUM — known anti-bot approach documented; actual bypass success requires a spike
- Product Hunt: HIGH (API structure) / MEDIUM (commercial use approval path)
- Schema design: HIGH — follows architecture already locked in ARCHITECTURE.md
- Idempotent upsert pattern: HIGH — Prisma ON CONFLICT confirmed in official docs

**Research date:** 2026-03-21
**Valid until:** 2026-04-20 (30 days) for stable items; re-verify Wellfound stealth feasibility before implementation
