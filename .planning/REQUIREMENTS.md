# Requirements: Cold Email Automation

**Defined:** 2026-03-15
**Core Value:** Automate startup discovery, contact enrichment, and personalized email generation end-to-end — so users focus on relationships, not research.

## v1 Requirements

### Authentication

- [ ] **AUTH-01**: User can create an account with email and password
- [ ] **AUTH-02**: User can sign in with Google OAuth (also enables Gmail sending)
- [ ] **AUTH-03**: User session persists across browser refresh

### Onboarding

- [ ] **ONBD-01**: User can upload their resume (PDF or text) stored per account
- [ ] **ONBD-02**: User can set sender info (name, role/title) and a base email template
- [ ] **ONBD-03**: User can store encrypted API keys (Apollo, Claude)
- [ ] **ONBD-04**: User can set default lead filters (industry, stage, location, contact role)

### Lead Discovery

- [ ] **DISC-01**: App pulls companies from YC, Wellfound, and Product Hunt into shared global pool via background jobs
- [ ] **DISC-02**: App enriches contacts with emails via user's Apollo API key
- [ ] **DISC-03**: User can filter the lead pool by company size, funding stage, location, industry, is-hiring, and contact role
- [ ] **DISC-04**: Location filtering groups nearby cities into named regions (e.g. "Bay Area" = SF + San Jose)
- [ ] **DISC-05**: User can manually add a company and contact to their lead list

### Lead Management

- [ ] **LEAD-01**: User can view all leads in a filterable, searchable dashboard
- [ ] **LEAD-02**: User can save leads to their personal list from the global pool
- [ ] **LEAD-03**: User can tag leads with status: New / Saved / Emailed / Rejected
- [ ] **LEAD-04**: User can bulk-select leads and trigger batch email generation

### Email Generation

- [ ] **EGEN-01**: App generates a personalized email per lead using Claude API with user's resume + template as context
- [ ] **EGEN-02**: App performs agentic context gathering (fetches recent company info) before generating each email
- [ ] **EGEN-03**: Email generation uses structural variation and anti-AI-pattern prompting to avoid spam filters
- [ ] **EGEN-04**: User can preview and edit each generated email before sending

### Email Sending

- [ ] **SEND-01**: User can send emails directly from the app via their Gmail account (OAuth2)
- [ ] **SEND-02**: App enforces per-user daily send caps to protect Gmail sender reputation
- [ ] **SEND-03**: Every sent email includes CAN-SPAM compliance elements (unsubscribe link, physical sender address)
- [ ] **SEND-04**: User can schedule emails to send at a specified future time

### Email Tracking

- [ ] **TRAK-01**: User can view all generated and sent emails in a dashboard
- [ ] **TRAK-02**: User can manually update email status (Sent / Replied / Interested / Rejected)
- [ ] **TRAK-03**: App auto-detects replies via IMAP polling and updates email status
- [ ] **TRAK-04**: App sends follow-up reminders to the user if no reply is received after a configurable number of days

## v2 Requirements

### Auth
- **AUTH-V2-01**: Password reset via email link

### Sourcing
- **SRC-V2-01**: Crunchbase integration for richer company funding data
- **SRC-V2-02**: LinkedIn enrichment for contact discovery

### Collaboration
- **COLB-V2-01**: Co-founder / collaborator mode with different email tone and targeting
- **COLB-V2-02**: University enrichment on contacts (for student-to-student outreach)

### Email Generation
- **EGEN-V2-01**: AI-generated follow-up email drafts
- **EGEN-V2-02**: A/B template testing across leads

### Analytics
- **ANLX-V2-01**: Dashboard showing open rates, reply rates, and best-performing templates

## Out of Scope

| Feature | Reason |
|---------|--------|
| LinkedIn scraping | ToS violation risk; high legal exposure |
| Clearbit enrichment | Too expensive for v1 |
| Real-time chat or messaging | Not core to cold email value |
| Mobile app | Web-first; mobile later |
| Open tracking (email pixels) | Privacy concerns; deliverability risk; status management covers v1 needs |
| Built-in email warmup service | Out of scope — users manage their own sender reputation |

## Traceability

*Populated during roadmap creation.*

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | — | Pending |
| AUTH-02 | — | Pending |
| AUTH-03 | — | Pending |
| ONBD-01 | — | Pending |
| ONBD-02 | — | Pending |
| ONBD-03 | — | Pending |
| ONBD-04 | — | Pending |
| DISC-01 | — | Pending |
| DISC-02 | — | Pending |
| DISC-03 | — | Pending |
| DISC-04 | — | Pending |
| DISC-05 | — | Pending |
| LEAD-01 | — | Pending |
| LEAD-02 | — | Pending |
| LEAD-03 | — | Pending |
| LEAD-04 | — | Pending |
| EGEN-01 | — | Pending |
| EGEN-02 | — | Pending |
| EGEN-03 | — | Pending |
| EGEN-04 | — | Pending |
| SEND-01 | — | Pending |
| SEND-02 | — | Pending |
| SEND-03 | — | Pending |
| SEND-04 | — | Pending |
| TRAK-01 | — | Pending |
| TRAK-02 | — | Pending |
| TRAK-03 | — | Pending |
| TRAK-04 | — | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 28 ⚠️

---
*Requirements defined: 2026-03-15*
*Last updated: 2026-03-15 after initial definition*
