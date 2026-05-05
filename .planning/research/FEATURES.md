> ARCHIVE NOTICE: This file is historical planning/research context and may describe superseded architecture or requirements. For current project truth, read `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `docs/adr/`, and `.planning/PROJECT.md` first.

# Feature Research

**Domain:** Cold email outreach SaaS — targeting students, internship seekers, and collaborator seekers focused on startup discovery
**Researched:** 2026-03-15
**Confidence:** MEDIUM-HIGH (competitor analysis from official sources; student/collaborator niche is less documented)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these means the product feels broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| User account (signup/login) | Every SaaS has this | LOW | Email/password + OAuth (Google). Required for multi-user data isolation. |
| Onboarding wizard | First-run experience is critical for activation; cold email tools have high setup overhead | MEDIUM | Must collect: sender info, Gmail/SMTP credentials, resume/bio, email template. Step-by-step is better than a wall of settings. |
| Resume / bio upload | Users expect their context to drive personalization — it's the core input | MEDIUM | Parse text from PDF or paste field. Stored per-user. Feeds AI generation. |
| Email template input | Users want to control tone/format; template is the starting scaffold | LOW | Plain text or light markdown. Stored per-user with named presets optional. |
| Lead discovery dashboard | Users expect to see discovered companies/contacts in one place | MEDIUM | Tabular view with company name, contact, role, funding stage, source. Filterable. |
| Lead filtering | B2B tools (Apollo, Instantly) all offer this; users expect to target their search | MEDIUM | Filters: industry, funding stage, company size, location/region, contact role, is-hiring flag. |
| AI email generation per lead | The product's core feature — users sign up for this specifically | HIGH | Claude API + resume + template + company context → personalized draft. Human-sounding tone is mandatory. |
| Email preview before send | Users want to review before sending; blind sending erodes trust | LOW | Show generated email with company/contact details before committing to send. |
| Direct email send from app | Copy/paste workflows feel unfinished; expected since Lemlist, Instantly both do this | MEDIUM | Gmail OAuth or SMTP. Sends from user's own address. |
| Sent email history / log | Users expect to see what was sent to whom and when | LOW | Per-user log: lead, subject, body, sent timestamp, current status. |
| Reply detection | Auto-detect that someone replied; manual polling is painful | MEDIUM | Gmail API polling or webhook. Mark lead status as "Replied" automatically. |
| Status tracking per lead | Users expect to know where each lead stands | LOW | Statuses: Sent, Replied, Interested, Rejected, Archived. Manual + auto-update. |
| Follow-up reminders | Every cold email tool has follow-up prompts; it's expected behavior | MEDIUM | Scheduled reminder N days after send with no reply. Trigger re-engagement email draft. |
| Basic sending limits / rate control | Gmail enforces limits; users expect the tool not to get their account flagged | MEDIUM | Per-day send cap, configurable delay between sends. Default: ~30 emails/day for new users, up to ~100 for warmed accounts. |
| Unsubscribe / opt-out handling | CAN-SPAM / GDPR compliance is non-negotiable since 2024 Google/Yahoo mandates | MEDIUM | Track opt-outs, suppress from future sends. One-click unsubscribe in email footer. |
| Email deliverability guidance | All modern tools surface this; users blame the tool when emails land in spam | LOW | Checklist or banner: SPF/DKIM/DMARC setup, sending limits, warm-up status. |

---

### Differentiators (Competitive Advantage)

Features that set this product apart from generic B2B sales tools. These align with the student/collaborator-seeker use case.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Startup-specific discovery (YC, Product Hunt) | Generic tools (Apollo, Instantly) do not focus on early-stage startups; this is an underserved niche | HIGH | Aggregate YC directory, Product Hunt launches. Apollo API supplements contact enrichment. |
| Funding-stage and hiring-status filters | Students target startups that are actively hiring or recently funded — not Fortune 500; no competitor offers this combination for this audience | MEDIUM | Filter by: Seed/Series A/B/C, is-hiring flag, recent funding from YC/Product Hunt context. |
| Region-aware location grouping | "Bay Area" should mean SF + San Jose + Oakland, not require manual multi-select | LOW | Predefined region aliases. E.g. "NYC metro", "Bay Area", "Chicago". Significantly reduces friction vs raw city filtering. |
| AI that matches user tone, not a generic template | Lemlist/Instantly AI writes B2B sales copy; this tool should produce student-voice, internship-specific, or co-founder-pitch prose | HIGH | Claude API with system prompt instructing human-sounding, non-salesy tone. User-provided writing samples or template drive tone. |
| Resume-as-context for AI generation | No current tool parses a resume and uses it as the personalization substrate | MEDIUM | Upload PDF, extract relevant experience/skills, inject into generation context per lead. Result: emails that reference specific relevant experience. |
| Agentic company context gathering pre-generation | Lemlist generates from static variables; this tool should fetch live company context (recent launches, team, product) before generating | HIGH | Web search / scrape per company before generation. Enables non-generic personalizations like "I saw your recent ProductHunt launch for X." |
| Shared global lead pool (multi-user deduplication) | Reduces redundant scraping cost; not a user-facing feature but enables lower pricing than per-user API call tools | HIGH | Companies/contacts stored globally; per-user tracking isolated. Users benefit from pre-enriched data when targeting the same companies. |
| Collaborator / co-founder mode (not just job seeking) | No mainstream tool addresses non-sales, relationship-oriented outreach for people seeking collaborators or co-founders | MEDIUM | Separate intent mode that changes email tone, target filters (founder/CTO roles vs recruiter roles), and template defaults. |
| Onboarding that produces first email within 5 minutes | Most tools require 30+ minutes of setup; students have low patience | MEDIUM | Streamlined wizard: upload resume → connect Gmail → pick startup vertical → generate first email immediately. Activation hook. |
| Follow-up email generation (not just reminders) | Tools remind users to follow up; this tool should generate the follow-up draft automatically | MEDIUM | On follow-up trigger, call Claude API with original email + context → generate non-repetitive follow-up. |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem desirable but introduce cost, legal risk, complexity, or scope creep that undermines the core value.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| LinkedIn scraping / outreach | "Reach more people" | LinkedIn ToS violation, legal exposure, account bans. Lemlist's LinkedIn feature requires official API which is enterprise-only. | Focus on email-first. Surface LinkedIn profile URL as a reference link if found via Apollo, but do not automate LinkedIn messages. |
| Full CRM (pipeline stages, deals, revenue tracking) | "Track my whole job search" | Scope creep. CRMs take years to build well. Students don't need deal revenue tracking. | Simple per-lead status (Sent/Replied/Interested/Rejected) is sufficient. Build a light kanban board later if validated. |
| Bulk import of arbitrary contact lists (CSV upload) | "I have my own leads" | Opens abuse vector (spam at scale). Complicates data model. Draws comparisons to spam tools, which affects deliverability reputation. | Support selective export/import of the app's own discovered leads. For v1, discovery is the core flow. |
| Email warm-up network (peer-to-peer inbox warming) | "Improve deliverability" | Building a warm-up network requires operating a large infrastructure of inboxes. High cost, legal grey area (simulating engagement). | Provide setup checklist for SPF/DKIM/DMARC and Gmail warm-up best practices documentation. Integrate with Mailreach or Warmup Inbox as an external service if needed later. |
| A/B testing email variants at scale | "Optimize reply rates" | Meaningful A/B testing needs statistical volume (hundreds of sends per variant). Students have small batches (10-50 per session). | Log all generated emails. Add variant tracking later when users are running high-volume campaigns. |
| Clearbit or Apollo enrichment for every contact automatically | "More data = better emails" | Clearbit is expensive ($250+/mo). Apollo API credits burn fast at scale. | Use Apollo API selectively (contact lookup only when user explicitly targets a lead). Cache results in shared pool. |
| Mobile app | "I want to check on my sends from my phone" | Web-first is sufficient for v1. Native mobile doubles development cost with minimal gain for a tool used primarily at a desk. | Responsive web UI. Mobile-optimized views can come after PMF. |
| Crunchbase or LinkedIn Sales Navigator integration | "More data sources" | Crunchbase free tier is very limited; paid plan is $500+/mo. LinkedIn Sales Navigator is enterprise-priced. | YC + Product Hunt + Apollo covers early-stage startup universe well enough for v1. Revisit Crunchbase in v2. |
| Automated sending without user review | "Fire and forget" | Students sending AI-generated emails to real people without review creates high risk of embarrassing or off-tone sends. Reputation damage is permanent. | Human-in-the-loop by default: generate email, require user to review and click send. Batch queue with approval flow as a v2 option. |
| Spam score analysis / inbox placement testing | "Make sure emails land in inbox" | Tools like GlockApps and Mailtrap do this well. Rebuilding this is expensive. | Surface guidance on deliverability best practices; integrate with a third-party service or link to free tools (Mail-tester.com). |

---

## Feature Dependencies

```
[User Account]
    └──requires──> [Gmail / SMTP Integration]
                       └──requires──> [Direct Send]
                                          └──enhances──> [Reply Detection]
                                                             └──triggers──> [Follow-up Reminders]
                                                                                └──enhances──> [Follow-up Email Generation]

[Resume Upload]
    └──requires──> [Onboarding Wizard]
    └──enhances──> [AI Email Generation]

[Startup Discovery (YC + ProductHunt)]
    └──requires──> [Lead Dashboard]
    └──enhances──> [Lead Filtering]
    └──feeds──> [Agentic Company Context Gathering]
                    └──requires──> [AI Email Generation]

[AI Email Generation]
    └──requires──> [Resume Upload]
    └──requires──> [Email Template Input]
    └──requires──> [Lead (company + contact data)]
    └──enhances──> [Email Preview before Send]

[Lead Filtering]
    └──requires──> [Lead Dashboard]
    └──enhances──> [Startup Discovery]

[Shared Global Lead Pool]
    └──enhances──> [Startup Discovery] (deduplication, cost)
    └──requires──> [User Account] (per-user tracking isolation)

[Collaborator Mode]
    └──requires──> [AI Email Generation] (different tone)
    └──requires──> [Lead Filtering] (different role targets)

[Status Tracking]
    └──requires──> [Sent Email History]
    └──enhanced by──> [Reply Detection]
```

### Dependency Notes

- **AI Email Generation requires Resume Upload:** The resume is the primary personalization substrate. Without it, generation falls back to generic output, which breaks the core value prop.
- **Reply Detection requires Gmail Integration:** Polling for replies uses the same OAuth token as sending. Can't detect replies via SMTP alone without additional webhook infrastructure.
- **Follow-up Reminders require Sent Email History:** You can only remind users to follow up if you know when the email was sent and that no reply has arrived.
- **Agentic Context Gathering enhances AI Email Generation:** Fetching current company context (recent launch, product description) before generation is what makes emails non-generic. This is the hardest part to build and the biggest differentiator.
- **Shared Global Lead Pool requires careful data isolation:** Company/contact records are shared; email history, status, and preferences are strictly per-user. Mixing these causes data leakage bugs.

---

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the concept end-to-end.

- [ ] User account (signup / login) — gating requirement for everything
- [ ] Onboarding wizard (sender info + Gmail OAuth + resume upload + email template) — without this, users cannot use the product
- [ ] Startup discovery from YC + Product Hunt (at minimum) — the core data pipeline
- [ ] Lead dashboard with basic filters (industry, funding stage, location) — required to select targets
- [ ] AI email generation using Claude API + resume + template + company context — the core value
- [ ] Email preview and single-send via Gmail — closes the loop; gives users the "it works" moment
- [ ] Per-lead status tracking (manual) — minimum tracking to feel organized
- [ ] Sent email history — users need to see what went out
- [ ] Follow-up reminders (time-based, N days after send with no reply) — high-value, low-complexity feature

### Add After Validation (v1.x)

Features to add once core flow is validated with real users.

- [ ] Reply auto-detection via Gmail API polling — reduces manual status management; add when users complain about tracking overhead
- [ ] Additional discovery sources (HN Hiring, Gregslist, VC portfolios) — adds surface area; add when YC/PH coverage feels thin
- [ ] Collaborator / co-founder mode — add when non-job-seeker users appear in signups
- [ ] Follow-up email AI generation — add when users ask "what do I say in the follow-up?"
- [ ] Region grouping for location filters — add when users in SF, NYC, etc. complain about city-level filtering
- [ ] Agentic company context gathering (web search per company) — high-complexity, high-value; add after base generation is stable

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] A/B testing email variants — defer until user volume is high enough to produce meaningful data
- [ ] Kanban pipeline view for lead status — defer; simple status column covers MVP needs
- [ ] Batch send queue with approval flow — defer; single-send with review is safer for v1
- [ ] Apollo as additional data source — defer; YC + PH sufficient to validate; Apollo adds cost
- [ ] University / campus network enrichment on contacts — deferred per PROJECT.md
- [ ] Email warm-up guidance or integration — defer; can link to external tools (Mailreach, Warmup Inbox)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| User account / auth | HIGH | LOW | P1 |
| Onboarding wizard | HIGH | MEDIUM | P1 |
| Resume upload + parsing | HIGH | MEDIUM | P1 |
| YC + Product Hunt discovery | HIGH | HIGH | P1 |
| Lead dashboard + filters | HIGH | MEDIUM | P1 |
| AI email generation | HIGH | HIGH | P1 |
| Email preview + send via Gmail | HIGH | MEDIUM | P1 |
| Sent email history | HIGH | LOW | P1 |
| Per-lead status (manual) | MEDIUM | LOW | P1 |
| Follow-up reminders | HIGH | MEDIUM | P1 |
| Reply auto-detection | HIGH | MEDIUM | P2 |
| Region grouping for location | MEDIUM | LOW | P2 |
| Additional discovery sources (HN Hiring, Gregslist, VC portfolios) | MEDIUM | MEDIUM | P2 |
| Follow-up email AI generation | HIGH | MEDIUM | P2 |
| Collaborator / co-founder mode | MEDIUM | MEDIUM | P2 |
| Agentic context gathering | HIGH | HIGH | P2 |
| Shared global lead pool | MEDIUM | HIGH | P2 |
| A/B testing | LOW | HIGH | P3 |
| Kanban pipeline view | LOW | MEDIUM | P3 |
| Apollo data source integration | MEDIUM | HIGH | P3 |
| Batch send queue with approval | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add after core is stable
- P3: Nice to have, defer to v2+

---

## Competitor Feature Analysis

| Feature | Lemlist | Instantly | Apollo | This Product |
|---------|---------|-----------|--------|--------------|
| Lead discovery source | Generic B2B DB, LinkedIn | B2B database (450M contacts) | 275M contacts, funding data | YC + Product Hunt + Apollo — startup-focused |
| AI email generation | AI icebreaker, dynamic vars | AI sequence generation | AI email assist | Resume-driven, tone-matched, agentic company context |
| Startup / funding filtering | No | Partial (industry/revenue) | Yes (funding events) | Yes — first-class filter for students targeting funded startups |
| Hiring status filter | No | No | Partial | Yes — is-hiring flag from ingested sources |
| Resume as AI context | No | No | No | Yes — primary differentiator |
| Collaborator / co-founder mode | No | No | No | Yes (v1.x) |
| Reply detection | Yes | Yes (AI categorization) | Yes | Yes — Gmail API polling |
| Follow-up reminders | Yes | Yes | Yes | Yes |
| Follow-up AI generation | Partial | Yes | Partial | Yes (v1.x) |
| Email warm-up | Yes (Lemwarm) | Yes (4.2M account network) | No | No — link to external tools |
| Onboarding wizard | No — steep setup | Moderate | Steep | Yes — 5-minute activation target |
| Target audience | B2B sales reps | B2B agencies / sales | B2B enterprise sales | Students, internship seekers, collaborator seekers |
| Pricing model | $79–$109/user/mo | $47+/mo | Free tier + $49+/mo | TBD — likely freemium with usage-based AI generation credits |

---

## Sources

- [Cold Outreach: Top 11 Tools 2026 — Findymail](https://www.findymail.com/blog/best-cold-outreach-tools/)
- [Apollo vs Lemlist 2026 — La Growth Machine](https://lagrowthmachine.com/apollo-vs-lemlist/)
- [Best Cold Email Software 2026 — Instantly](https://instantly.ai/blog/best-cold-email-software-for-agencies-2026/)
- [20 Best Cold Email Software 2026 — Hunter](https://hunter.io/blog/cold-email-software/)
- [Cold Email in 2026: What's Changed — WSI](https://www.wsidminc.com/post/cold-email-in-2026-what-s-changed-and-what-still-works)
- [AI-Powered Cold Email Personalization — Instantly](https://instantly.ai/blog/ai-powered-cold-email-personalization-safe-patterns-prompt-examples-workflow-for-founders/)
- [How to Use AI for Cold Email 2025 — Hunter](https://hunter.io/ai-cold-email-guide)
- [Apollo vs Instantly 2026 — Saleshandy](https://www.saleshandy.com/blog/apollo-vs-instantly/)
- [AI Cold Email Reply Management — Instantly](https://instantly.ai/blog/ai-cold-email-reply-management-for-agencies/)
- [Cold Email Benchmark Report 2026 — Instantly](https://instantly.ai/cold-email-benchmark-report-2026)
- [Gmail Sending Limits 2026 — Smartlead](https://www.smartlead.ai/blog/gmail-sending-limits)
- [Cold Email Deliverability 2026 — Instantly](https://instantly.ai/blog/how-to-achieve-90-cold-email-deliverability-in-2025/)
- [Lemlist vs Hunter 2025 — Growleady](https://www.growleady.io/tools/lemlist-vs-hunter)
- [OutreachKit — Startup Contacts for Cold Emailing](https://www.outreachkit.shop/)
- [Startup Founder Discovery + AI Outreach (n8n workflow)](https://n8n.io/workflows/4729-startup-founder-discovery-and-ai-powered-outreach-with-crunchbase-and-gmail/)

---
*Feature research for: Cold Email Automation SaaS — students, internship seekers, collaborator seekers*
*Researched: 2026-03-15*
