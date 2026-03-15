# Pitfalls Research

**Domain:** Cold Email Outreach SaaS (web scraping + Apollo API + Gmail SMTP + AI personalization)
**Researched:** 2026-03-15
**Confidence:** HIGH (most findings cross-verified with official docs and current industry sources)

---

## Critical Pitfalls

### Pitfall 1: Sending From a Cold Domain With No Warmup

**What goes wrong:**
App is built, users connect their Gmail account, and emails start flowing immediately. Gmail and Outlook treat every new domain (and unfamiliar sending pattern) as a potential spam source. Emails land in spam. Replies drop to near zero. Domain reputation is damaged, sometimes permanently within 2-3 days of aggressive sending.

**Why it happens:**
Developers test with small volumes (5-10 emails per dev test) and assume users will do the same. Users don't know to warm up their sending domain before going full volume.

**How to avoid:**
- Enforce a per-user daily send cap in the app (start at 20-30/day for new connected accounts)
- Show a "sending readiness" indicator in onboarding based on Gmail account age and prior sending activity
- Document the warmup expectation explicitly: users must ramp from 5-10/day over 4-6 weeks to reach 100+/day safely
- Never allow bulk "send all" actions for users who haven't established a sending history

**Warning signs:**
- User reports their emails going to spam immediately
- Gmail account gets suspended within days of first campaign
- Bounce rates above 2% on first campaign
- User's sending domain was registered recently (< 30 days)

**Phase to address:** Email Sending (Phase: Gmail SMTP integration) — enforce caps at the infrastructure layer, not just UI

---

### Pitfall 2: Gmail OAuth Scope Too Broad + Token Refresh Failures

**What goes wrong:**
App requests `https://mail.google.com/` (full mailbox access) when it only needs send + read inbox for reply detection. Users see the scary "access all your email" consent screen and abandon. Alternatively: refresh tokens are not persisted securely, so they expire or get revoked and users are silently disconnected — emails stop sending with no alert.

**Why it happens:**
Full mailbox scope is the obvious "just works" choice. Refresh token persistence is an afterthought.

**How to avoid:**
- Use minimum necessary scopes: `gmail.send` for sending, `gmail.readonly` or `gmail.modify` only if reply detection requires it
- For reply detection, prefer `gmail.readonly` + Gmail API `history.list` over full IMAP access
- Store refresh tokens encrypted in the database (not in session, not in env vars)
- Implement token health checks: on every job run, verify the token is valid; alert the user + pause their queue if refresh fails
- There is a hard limit of 100 refresh tokens per Google account per OAuth client — if exceeded, oldest tokens are revoked. For a multi-user app this is per OAuth client, not per user account.

**Warning signs:**
- OAuth consent drop-off is high (users authorizing but not completing onboarding)
- Silent job failures — emails stop sending but no error surface to user
- Users complaining "it worked yesterday but stopped"

**Phase to address:** Auth & Gmail Integration phase — establish token lifecycle management from day one

---

### Pitfall 3: Scraping YC / Product Hunt / Wellfound Aggressively Without Rate Limiting

**What goes wrong:**
Scraper hammers the target site, triggers IP blocks or CAPTCHAs within hours. Wellfound in particular uses anti-scrape protections. YC's directory has no official API. Product Hunt has a public GraphQL API but rate-limits it. Getting blocked means the shared contact DB stops refreshing — all users degrade simultaneously.

**Why it happens:**
Scrapers are written to "just get the data" in development where single-run tests work fine. Production runs at much higher frequency and volume.

**How to avoid:**
- Respect `robots.txt` and reasonable crawl delays (1-3 seconds between requests minimum)
- Use rotating user-agent strings and residential proxies for sites that block datacenter IPs
- Cache aggressively: if a company was scraped in the last 7 days, skip it — don't re-fetch
- Build a dedicated scrape scheduler that spreads work across hours/days, not minutes
- Store raw scrape errors and detect when a source has started blocking (>20% failure rate on a source = pause and alert)
- For Product Hunt: use their official API (`https://api.producthunt.com/v2/api/graphql`) with OAuth; do not scrape the HTML

**Warning signs:**
- Scrape jobs completing in under 30 seconds (likely hitting blocks silently)
- Sudden drop in newly discovered companies
- HTTP 429s, 403s in job logs
- CAPTCHA responses being returned as valid data

**Phase to address:** Data Ingestion (scraping + Apollo) phase — build rate limiting and retry infrastructure before scale testing

---

### Pitfall 4: Shared Contact DB Serves Stale / Bouncing Emails

**What goes wrong:**
Apollo data has a TTL. Contacts that were valid 6 months ago may have left the company. Emails sent to stale contacts bounce. Bounces above 2% damage the user's domain reputation. Because the contact DB is shared, one stale data refresh that missed a batch of departures can harm all users simultaneously.

**Why it happens:**
It's tempting to populate the shared DB once and cache indefinitely to minimize Apollo API credit consumption. No one implements a staleness TTL.

**How to avoid:**
- Store a `last_verified_at` timestamp on every contact; flag contacts older than 90 days as "needs verification"
- Before a user sends to a contact, check the freshness flag and offer to re-verify via Apollo
- Integrate a lightweight email verification check (MX record + syntax at minimum) before sending — reject obvious dead addresses
- Track per-contact bounce history across the platform: if 3+ users bounced on an address, mark it invalid globally
- Expose staleness info in the lead dashboard so users can filter it out

**Warning signs:**
- Bounce rates creeping above 1% on campaigns
- Users complaining their "new leads" are unresponsive or bouncing
- Contacts at companies that closed or pivoted still appearing as valid

**Phase to address:** Shared DB + Lead Management phase — model `last_verified_at` and staleness at schema design time

---

### Pitfall 5: AI-Generated Emails Sound Identical Across All Users

**What goes wrong:**
Every user's Claude-generated email starts with "I came across [Company] and was impressed by..." or "As someone with experience in X, I believe I could contribute to...". Spam filters in 2026 are trained on billions of AI-generated cold emails and recognize these structural patterns. What passes one user's review gets flagged at the receiving server.

**Why it happens:**
The prompt is written once and shared across all users. Developers test with their own email and see it looks good. They don't test what 50 users generating from the same prompt looks like at volume.

**How to avoid:**
- Build structural variation into the prompt: rotate openers, vary call-to-action phrasing, randomize email length targets
- Include a "writing style seed" derived from the user's resume and template to ensure inter-user variation
- Explicitly instruct Claude to avoid known spam trigger phrases (free, guaranteed, act now) and AI-sounding openers
- Test output across 20+ generations before release; run samples through a spam score checker (Mail-Tester or similar)
- Let users preview and edit generated emails before sending — never auto-send without review option

**Warning signs:**
- Multiple users report the same deliverability problems at the same time
- Open rates drop significantly after a period of normal performance
- Spam score tools flag structure, not content

**Phase to address:** Email Generation (AI) phase — variation and anti-pattern logic baked into the prompt architecture, not added later

---

### Pitfall 6: Apollo Credit Exhaustion With No User Feedback

**What goes wrong:**
A user runs a broad lead search, triggering hundreds of contact enrichment requests. Apollo credits are exhausted silently. Subsequent enrichment calls fail, but the UI shows "lead found" with no email address. The user has no idea why emails aren't generating. If credits are shared across a pool, one power user can drain credits for all other users.

**Why it happens:**
Apollo's credit system is granular and plan-dependent. Developers assume credits are abundant in testing; they aren't in production lower-tier plans.

**How to avoid:**
- Check Apollo credit balance before every enrichment batch job; surface remaining credits in the user's settings page
- Implement per-user credit quotas within the app to prevent one user exhausting the shared pool
- Cache enrichment results in the shared DB — never call Apollo twice for the same contact within the TTL window
- Gracefully degrade: when Apollo credits are low, show "limited enrichment available" rather than silently failing
- Alert the operator (via email/Slack webhook) when Apollo credits drop below 20%

**Warning signs:**
- Apollo API returns 402 or 429 with a "credits exhausted" message
- Contacts discovered but email fields empty across many records
- Users reporting that the same company search returns results but no contact emails

**Phase to address:** Apollo Integration phase — build credit accounting before enabling enrichment at scale

---

### Pitfall 7: Reply Detection Breaks When Gmail OAuth Token Expires

**What goes wrong:**
Reply detection uses Gmail API history polling. The OAuth token expires (access tokens last ~1 hour; refresh tokens can be revoked). The background job fails silently. Users don't see new replies surfaced in the dashboard. They miss interested responses. They think the tool is broken.

**Why it happens:**
Reply detection is background infrastructure, not visible to users. When it breaks, there's no immediate user-facing failure — just silent data loss.

**How to avoid:**
- Use Gmail API push notifications (Cloud Pub/Sub) for reply detection rather than polling — more reliable and lower latency
- If polling, implement health-check jobs that test token validity independently from the reply-detection job
- Surface Gmail connection status prominently in the dashboard: "Connected | Last synced: 5 min ago" vs "Disconnected — reconnect to detect replies"
- When a refresh token is revoked (user changes Google password, revokes app access), pause the user's queue and send them an email to reconnect

**Warning signs:**
- Users reporting they got email replies but the app shows no reply detected
- Reply detection jobs completing in 0ms (likely silently skipping due to auth error)
- Tokens not being refreshed on schedule

**Phase to address:** Reply Detection phase — auth health monitoring must precede reply detection feature launch

---

### Pitfall 8: CAN-SPAM / GDPR Compliance Treated as a Checkbox

**What goes wrong:**
An unsubscribe link is added to the email template but has no backend — clicking it does nothing. Or: the app sends to EU-based contacts without documenting a GDPR lawful basis. Fines for CAN-SPAM are $51,744 per email. GDPR fines reach 4% of global annual revenue.

**Why it happens:**
Compliance is deferred to "later" while features ship. The unsubscribe UX looks done in a demo (the link is there) but the suppression list doesn't exist.

**How to avoid:**
- Build a suppression list table (`unsubscribed_emails`) before the sending feature ships
- Every outgoing email MUST include: sender's physical address, clear identification as an outreach email, and a functional one-click unsubscribe
- When an unsubscribe is processed, globally suppress that email address — no user on the platform can send to it again
- For EU contacts: document the GDPR lawful basis in your privacy policy (B2B "legitimate interest" is defensible; scraping personal Gmail addresses is not)
- Log all unsubscribes with timestamps for audit compliance
- Process opt-outs within 10 business days (CAN-SPAM) — the app should process immediately

**Warning signs:**
- Unsubscribe link in template but no suppression list in the database schema
- No physical address in email templates
- User can resend to an address they previously got a "stop emailing me" reply from

**Phase to address:** Email Sending phase — suppression list and unsubscribe infrastructure are prerequisites for launch, not post-launch polish

---

### Pitfall 9: Supabase RLS Misconfiguration Leaks Cross-User Data

**What goes wrong:**
In the shared global company/contact pool, Row Level Security policies are added late or misconfigured. A policy written as `USING (true)` gives every logged-in user read access to all rows. A missing policy on a new table means the service role (used by background jobs) can read any user's email history. Users can see each other's sent emails, lead notes, or API keys.

**Why it happens:**
Supabase creates tables with RLS disabled by default. Developers add RLS policies after the fact, often missing tables added during iteration. The service role bypasses all RLS — background jobs using the service role key inadvertently have access to everything.

**How to avoid:**
- Enable RLS on every table before the first INSERT — not as a follow-up task
- Have two clear data tiers: global shared tables (companies, contacts) accessible by all users in read mode; per-user tables (emails, preferences, notes, API keys) locked to `auth.uid() = user_id`
- Never use the Supabase service role key in client-side code — only in server-side jobs
- Write tests that assert cross-user data isolation: user A's email history must not be readable by user B
- Keep API keys (Apollo key, Claude key stored per user) encrypted at rest, never in plaintext columns

**Warning signs:**
- A query run as user A returns rows belonging to user B
- RLS policies not appearing in the Supabase dashboard for a table
- Service role key used in frontend environment variables (`.env.local`)

**Phase to address:** Auth & Multi-user foundation phase — data isolation must be validated before any per-user data is stored

---

### Pitfall 10: BullMQ Jobs Are Not Idempotent, Creating Duplicate Emails

**What goes wrong:**
A scraping or email generation job is queued, starts processing, and the worker crashes (server restart, Vercel timeout, Redis connection drop). BullMQ retries the job. The job runs again and generates a second email to the same contact. The user sends a duplicate cold email to the same person, which destroys credibility.

**Why it happens:**
BullMQ does not enforce idempotency automatically. Developers write job handlers that aren't defensive about "already ran for this contact" states.

**How to avoid:**
- Use deterministic job IDs (e.g., `email-gen-{userId}-{contactId}`) so BullMQ skips if a job with that ID already exists in the queue
- Store job state in the database: before processing, check `WHERE contact_id = X AND user_id = Y AND status IN ('queued', 'sent')` — exit early if found
- Use database transactions with unique constraints (`user_id + contact_id + campaign_id`) to make the "mark as sent" step atomic
- For email sending jobs specifically: write the send record to the DB before calling Gmail SMTP — treat "record exists" as "already sent"
- Configure Redis with `maxmemory-policy noeviction` — if Redis evicts job keys, BullMQ loses queue state silently

**Warning signs:**
- Users reporting "I got two emails sent to the same person"
- Duplicate rows appearing in the emails table for the same `user_id + contact_id`
- Jobs completing multiple times per contact in logs

**Phase to address:** Background Jobs (BullMQ/Redis) phase — idempotency patterns must be established before email sending is connected

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single Apollo API key shared across all users | Simpler to implement | One breach exposes all enrichment; credit exhaustion by one user affects all | Never — per-user keys or isolated credit pools required |
| Polling Gmail inbox every minute for replies | Easy to implement without Cloud Pub/Sub setup | Exhausts API quota, hits 1B/day Gmail API limit at scale, tokens expire silently | MVP only with hard rate limits; replace before multi-user scale |
| Storing user API keys in plaintext DB column | Fast to implement | Catastrophic if DB is compromised | Never |
| Running scraping on Vercel serverless functions | No separate infrastructure | 10s execution timeout kills long scrape runs; no persistent state | Never for scraping — use background workers |
| Skip email verification before sending | Faster lead flow | Bounce rates degrade domain reputation permanently | Never — even basic MX record check is required |
| Same system prompt for all users' email generation | One prompt to maintain | Homogenized output gets collectively flagged by spam filters | MVP only with intent to add variation within first month |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Gmail OAuth | Requesting `https://mail.google.com/` full scope for all operations | Use `gmail.send` + `gmail.readonly` minimum; escalate scope only if IMAP fallback is required |
| Gmail OAuth | Not handling token revocation (user changes password, removes app) | Catch `invalid_grant` errors in token refresh; pause queue + notify user immediately |
| Gmail SMTP | Using app password (basic auth) instead of OAuth 2.0 | Google deprecated basic auth for Google Workspace in May 2025; OAuth 2.0 is mandatory |
| Apollo API | Calling People Enrich for every search result regardless of cache | Check shared DB first — if contact was enriched < 90 days ago, use cached data |
| Apollo API | Not handling 429 rate limit responses | Exponential backoff with BullMQ retry + jitter; surface "enrichment throttled" state to user |
| Wellfound scraping | Treating it like a static HTML scrape | Wellfound uses React SPA with anti-bot protections; requires headless browser (Playwright/Puppeteer) |
| YC scraping | Scraping yc.com directly | Use `https://www.ycombinator.com/companies` JSON endpoint (publicly accessible, less fragile than HTML scraping) |
| Claude API | Sending full resume as context on every generation | Chunk and summarize resume once per user; cache the summary. Full resume = large token cost per email |
| BullMQ + Redis | Not setting `removeOnComplete` and `removeOnFail` options | Completed/failed jobs accumulate in Redis memory indefinitely, causing OOM on long-running instances |
| Supabase | Using service role key in Next.js API routes exposed to client | Service role bypasses all RLS; only use in server-side jobs with no client exposure |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fetching all companies for a user's filter on every dashboard load | Dashboard slow, DB load spikes | Paginate + index filter columns (`funding_stage`, `location`, `industry`); cache filter results | > 10,000 companies in shared DB |
| Generating all emails for a batch synchronously | Request timeout, partial batch on error | Queue each email generation as individual BullMQ jobs with per-job status tracking | > 5 emails per batch |
| IMAP polling reply detection per-user per-minute | Gmail API quota exhausted (1B units/day shared across all users) | Use Gmail push notifications (Pub/Sub) or poll at most every 15 minutes per user | > 50 active users |
| No index on `contacts.email` in shared DB | Email deduplication queries become table scans | Add unique index on `email` at migration time | > 50,000 contacts |
| Storing email body HTML in main emails table | Large row sizes, slow email list queries | Store email body in separate table or object storage; main table has only metadata | > 10,000 sent emails |
| Running scrape jobs synchronously in the web request handler | Request timeouts, duplicate scrapes triggered by user retrying | All scraping must be async BullMQ jobs; return job ID immediately, poll for status | Every time |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing per-user API keys (Claude, Apollo) in plaintext | Full key compromise if DB is accessed | Encrypt with AES-256 at rest; decrypt only at job runtime in server-side code |
| RLS not enabled on a new table | Any authenticated user can read all rows via Supabase client | Enable RLS before first INSERT on every table; enforce in migration scripts |
| User-controlled email template injected directly into Claude prompt | Prompt injection: user crafts template to exfiltrate other users' data | Sanitize user content before interpolating into prompts; use system/user prompt separation |
| Sending user's Gmail OAuth tokens in client-side state | Token theft via XSS | Tokens stored only server-side; never in localStorage, cookies without httpOnly, or client state |
| Global unsubscribe suppression not enforced | Re-sending to opted-out contacts = CAN-SPAM violation | Suppression list checked as a pre-send gate in the BullMQ job, not just in UI |
| Scraping login-gated content (e.g., Wellfound logged-in profiles) | CFAA exposure beyond ToS breach | Restrict scraping to publicly accessible, non-login-required pages only |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No sending status visibility | Users don't know if emails are queued, sending, or stuck | Real-time job status per email: Queued → Generating → Sending → Sent / Failed |
| "Send all" button with no confirmation or daily cap warning | Accidental mass send damages domain reputation | Show estimated send volume, projected days to complete at safe daily cap, require confirmation |
| Generated email shown only in final preview | User can't iterate on tone without re-generating | Let user edit inline before sending; save edits back to the record |
| Stale lead data silently used | User sends to a bouncing email, confused why | Show `last_verified_at` on each contact; flag stale contacts with a visual indicator |
| Reply detected but no notification | User misses interested responses | In-app notification + optional email digest when new replies are detected |
| API key configuration buried in settings | Users don't connect Apollo/Claude and wonder why features don't work | Onboarding checklist with explicit "connect API keys" step before first campaign is allowed |

---

## "Looks Done But Isn't" Checklist

- [ ] **Unsubscribe link:** Present in template UI — verify the backend suppression list actually blocks re-sending to that address
- [ ] **Reply detection:** "Connected" shown in UI — verify history polling/Pub/Sub is actually receiving events, not silently failing
- [ ] **Apollo enrichment:** Contact shows email in DB — verify email was validated (MX record + format), not just stored raw
- [ ] **Email sending:** "Sent" status in dashboard — verify Gmail API returned 200, not that the BullMQ job completed without error-checking the API response
- [ ] **RLS enabled:** Table created in Supabase — verify policies exist AND are correct (a table with RLS enabled but no policies returns zero rows silently)
- [ ] **OAuth token refresh:** User authenticated — verify refresh token is stored encrypted and token refresh loop is running on background jobs
- [ ] **Duplicate prevention:** Emails table has `user_id + contact_id` — verify a unique constraint exists at the DB level, not just enforced in application logic
- [ ] **GDPR physical address:** Unsubscribe link in email — verify sender's physical address is also in every outgoing email body

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Domain reputation damaged from aggressive early sends | HIGH | Stop all sending for 2-4 weeks; send only to known engaged contacts; contact Google Postmaster Tools to monitor recovery |
| Apollo credits exhausted mid-campaign | MEDIUM | Pause all enrichment jobs; notify affected users; upgrade plan or wait for monthly reset; use cached data where available |
| Duplicate emails sent | MEDIUM | Identify affected contacts via DB query; send one apology follow-up; add unique constraint to prevent recurrence |
| Supabase RLS data leak discovered | HIGH | Immediately rotate all API keys; audit access logs; notify affected users; apply correct RLS policies; consider legal notification requirements |
| Scraper source blocked (IP banned) | LOW-MEDIUM | Switch to residential proxy rotation; implement longer crawl delays; rebuild cache from unblocked sources; consider official API alternatives |
| Gmail OAuth tokens mass-revoked (Google policy change) | HIGH | Send re-auth email to all affected users; pause all queues; provide clear reconnection flow; implement proactive token health monitoring |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Cold domain / no warmup | Email Sending phase | New connected account's daily send cap is enforced at job level, not just UI |
| Gmail OAuth scope + token refresh | Auth & Gmail Integration phase | Integration test: revoke token, verify queue pauses and user is notified |
| Scraping rate limiting | Data Ingestion phase | Source health check endpoint shows per-source error rates; test with intentional throttle |
| Stale contact data | Shared DB + Lead Management phase | Schema has `last_verified_at`; query for contacts > 90 days returns correct staleness flag |
| AI email homogeneity | Email Generation phase | Generate 20 emails from same prompt; manually verify structural variation across outputs |
| Apollo credit exhaustion | Apollo Integration phase | Credit balance is visible in settings; enrichment job checks balance before running |
| Reply detection token expiry | Reply Detection phase | Token health check runs independently; expired token surfaces in user dashboard within 15 min |
| CAN-SPAM / GDPR compliance | Email Sending phase (pre-launch gate) | Suppression list blocks re-send; every email contains physical address + unsubscribe link |
| Supabase RLS misconfiguration | Auth & Multi-user Foundation phase | Test asserts user A cannot read user B's emails, notes, or API keys |
| BullMQ job duplicate emails | Background Jobs phase | Unique constraint on `user_id + contact_id + campaign_id`; idempotency test with simulated worker crash |

---

## Sources

- [Apollo.io Rate Limits Documentation](https://docs.apollo.io/reference/rate-limits) — official, current
- [Apollo.io API Pricing](https://docs.apollo.io/docs/api-pricing) — official, current
- [Gmail Sending Limits 2026 - SmartLead](https://www.smartlead.ai/blog/gmail-sending-limits) — MEDIUM confidence
- [Gmail OAuth 2.0 Authentication Changes 2026 - Mailbird](https://www.getmailbird.com/gmail-oauth-authentication-changes-user-guide/) — MEDIUM confidence
- [Gmail API OAuth Scopes - Google Developers](https://developers.google.com/workspace/gmail/api/auth/scopes) — official, HIGH confidence
- [Gmail API Push Notifications - Google Developers](https://developers.google.com/workspace/gmail/api/guides/push) — official, HIGH confidence
- [OAuth 2.0 Mechanism - Google Developers](https://developers.google.com/workspace/gmail/api/imap/xoauth2-protocol) — official, HIGH confidence
- [Google Workspace Legacy Auth Deprecation](https://support.google.com/a/answer/14114704?hl=en) — official, HIGH confidence (basic auth deprecated May 2025)
- [BullMQ Retrying Failing Jobs](https://docs.bullmq.io/guide/retrying-failing-jobs) — official, HIGH confidence
- [BullMQ Troubleshooting](https://docs.bullmq.io/guide/troubleshooting) — official, HIGH confidence
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — official, HIGH confidence
- [Cold Email Deliverability Guide 2026 - Amplemarket](https://www.amplemarket.com/blog/email-deliverability-guide-2026) — MEDIUM confidence
- [Cold Email Compliance 2026 - OutreachBloom](https://outreachbloom.com/cold-email-compliance) — MEDIUM confidence
- [How AI Spam Filters Work 2026 - Medium](https://medium.com/@genai.works/how-ai-spam-filters-actually-work-in-2026-e4546d39d56d) — LOW confidence (single source)
- [Cold Email in 2026: Spam Filters Are Watching - TextPolish](https://www.text-polish.com/blog/cold-email-2026-spam-filters-ai-detection) — MEDIUM confidence
- [How to Scrape Wellfound - ScrapFly](https://scrapfly.io/blog/posts/how-to-scrape-wellfound-aka-angellist) — MEDIUM confidence
- [Is Web Scraping Legal 2025 - Browserless](https://www.browserless.io/blog/is-web-scraping-legal) — MEDIUM confidence
- [Email Domain Warm-Up 2026 - MailReach](https://www.mailreach.co/blog/how-to-warm-up-email-domain) — MEDIUM confidence
- [Supabase MCP Data Leak Risk - General Analysis](https://www.generalanalysis.com/blog/supabase-mcp-blog) — MEDIUM confidence
- [Evaluating Spam Filters and AI Detection - ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0957417425006669) — HIGH confidence (peer-reviewed)

---
*Pitfalls research for: Cold Email Outreach SaaS (YC/PH/Wellfound scraping + Apollo API + Gmail SMTP + Claude AI)*
*Researched: 2026-03-15*
