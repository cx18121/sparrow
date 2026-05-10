# Sparrow

## What This Is

Sparrow is a campaign-first cold outreach workspace for students. It helps users discover startup companies, find contacts, generate reviewed email drafts with resume/company context, and send those drafts through the user's Gmail account.

The active product is a Vite React app with Vercel Functions, Supabase, Prisma, Apollo, Anthropic Claude, Exa, and Tavily. It is not a Next.js/BullMQ worker app.

## Core Value

Help students move from "I want to reach these companies" to specific, editable, sent outreach with less manual research, less copying between tools, and clearer status.

## Active Product Scope

- User authentication through Supabase, including Google sign-in.
- Gmail sending through Google OAuth and `gmail.send`.
- Campaign-first IA:
  - Global sidebar: Home, Templates, Settings.
  - Campaign workspace: Overview, Leads, Drafts, Sent, Settings.
- Three Settings tabs: Profile, Sending, Account.
- Shared global Company and Contact pool; user-owned Leads and Custom Contacts.
- Campaign wizard with filters, dedup toggle, template selection, and review.
- Audience filters by funding stage, region, YC batch, hiring, and namespaced tags. Headcount is retired from the UI.
- Apollo contact search and paid email reveal flow.
- Host-managed Claude via `ANTHROPIC_API_KEY`.
- Exa-first company research with Tavily fallback on zero Exa results.
- Template library with merge tags, attachments, default verbatim mode, and opt-in AI rewrite.
- Draft review/edit/send flow with per-user send limits and Gmail connection checks.

## Out Of Scope For Current v1

- Reply tracking and auto-detected replies.
- Scheduled sending.
- Open/click tracking pixels.
- LinkedIn scraping.
- Per-user BYO Claude or Apollo keys.
- Product Hunt as a primary live source.
- BullMQ/Redis background workers.
- Native mobile app.

## Context

- **Target users:** students doing internships, recruiting, club sponsorship, founder outreach, or networking.
- **Primary pain point:** cold outreach is slow because finding relevant companies, identifying contacts, researching recent company context, and writing specific emails all take manual effort.
- **Data sources:** current verified company pool comes from YC, VC/source scripts, TheHub and related ingestion/enrichment scripts. Apollo is used for contact previews/reveals.
- **Email generation:** per-company research produces a cached dossier; per-user fit-angle picking combines the dossier with resume/background text; templates can fill tags verbatim or opt into Claude rewrite.
- **Data model:** Companies and Contacts are shared; Leads, Custom Contacts, Campaigns, Templates, and Emails are user-scoped.

## Architectural Decisions

| Decision | Current outcome |
|---|---|
| Campaign-first IA | Home + Templates + Settings globally; work happens inside `/campaigns/:id/*`. |
| Host-managed Claude | Server reads `ANTHROPIC_API_KEY`; BYO key UI and reads/writes are retired. |
| Gmail OAuth | Google sign-in asks for identity + `gmail.send`; Settings Account tab remains manual reconnect path. |
| Template behavior | `verbatim = true` by default; AI rewrite is opt-in per template. |
| Research retrieval | `researchCompanyDossierHybrid`: Exa first, Tavily fallback only on zero Exa results. |
| Audience headcount | UI/API audience filtering ignores headcount; column can remain for ingestion/legacy data. |
| Status vocabulary | `LeadStatus`: SAVED, EMAILED, NO_RESPONSE, DECLINED. No NEW or REJECTED. |

---
*Last updated: 2026-05-05*
