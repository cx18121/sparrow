# Cold Email Automation

## What This Is

A multi-user SaaS platform that automates the entire cold email outreach process for job seekers and collaborators. It discovers startups and their contacts from multiple sources (YC, Product Hunt, Wellfound, Apollo), filters them by user preferences, and generates human-sounding personalized emails using the user's resume and email template — then sends and tracks those emails directly from the app.

## Core Value

Save users hours of manual work by automating startup discovery, contact enrichment, and personalized email generation end-to-end — so they can focus on relationships, not research.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Users can sign up and manage their own account
- [ ] Users can input their resume, sender info, email template, and API keys during onboarding
- [ ] App pulls startups and contacts from YC, Product Hunt, Wellfound, and Apollo
- [ ] Shared global company/contact pool across users (reducing redundant API calls)
- [ ] Users can filter leads by company size, funding stage, location, industry, is-hiring, and contact role
- [ ] Location filtering groups nearby cities into regions (e.g. "Bay Area" = SF + San Jose)
- [ ] App generates personalized, human-sounding emails per lead using Claude API + user resume + template
- [ ] Email generation avoids AI-sounding patterns and matches user's tone
- [ ] Users can send emails directly from the app (Gmail/SMTP integration)
- [ ] Lead dashboard to store, view, and manage discovered companies and contacts
- [ ] Email dashboard to store, view, and manage generated/sent emails
- [ ] Email tracking: manual status management (Sent / Replied / Interested / Rejected)
- [ ] Email tracking: auto-detect replies
- [ ] Email tracking: follow-up reminders after no response

### Out of Scope

- LinkedIn scraping — restricted by ToS, high legal risk
- Clearbit enrichment — too expensive for v1
- Crunchbase — limited emails, deprioritized for v1
- Mobile app — web-first
- University enrichment on contacts — deferred to later

## Context

- **Target users**: Students looking for internships; people seeking co-founders or collaborators
- **Primary pain point**: Cold emailing is slow — finding companies, finding valid emails, and writing personalized messages all take significant manual effort
- **Data sources (v1)**: Y Combinator directory, Product Hunt, Wellfound (AngelList), Apollo.io
- **Email generation**: Agentic search gathers company context → combined with user resume + template → Claude API generates email
- **Background processing**: Redis + BullMQ for lead scraping and enrichment jobs
- **Global DB model**: Companies and contacts are stored in a shared pool with filter tags; per-user tracking and email history are isolated

## Constraints

- **Tech Stack**: Next.js, TypeScript, Tailwind CSS, PostgreSQL (Supabase), Prisma, Apollo API, Claude API, Redis + BullMQ, Vercel — stack is decided
- **Data**: Email accuracy depends on Apollo API tier; Product Hunt and YC require scraping or unofficial APIs
- **Cost**: Apollo API limits on lower plans; need to optimize shared DB to avoid per-user re-fetching
- **Compliance**: Email sending must respect CAN-SPAM / GDPR basics (unsubscribe, sender info)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Shared global company pool | Reduces redundant API calls across users, lowers cost | — Pending |
| App sends emails directly | Better UX than copy/paste; enables reply tracking | — Pending |
| YC + Product Hunt + Wellfound + Apollo for v1 | Best coverage of early-stage startups at lowest cost | — Pending |
| Claude API for email generation | Enables tone-matching, semantic customization, avoids AI patterns | — Pending |

---
*Last updated: 2026-03-15 after initialization*
