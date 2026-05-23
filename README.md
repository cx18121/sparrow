# Sparrow

Campaign-first cold outreach for students. Sparrow helps users find startup contacts, draft specific emails from their resume/background context, and send reviewed drafts through Gmail.

> Live at [usesparrow.dev](https://usesparrow.dev).

Built for students doing cold outreach towards startups where the difference between "another cold email" and "actual reply" is whether the message references something specific and recent about the company.

Sparrow does the research and drafting work around the user's review loop. Pick a campaign, find contacts, choose or write a template, then generate drafts with per-company context before editing and sending.

## How it works

1. **Pick a startup.**  
   Filter 40k+ verified companies by tags (sector, tech, stage, investor, region). Sources include YC, a16z, Sequoia, Kleiner Perkins, Greylock, dozens of other VC and accelerator portfolios, and verified startup lists.

2. **Find contacts.**  
   Apollo search returns contact previews for a company. Revealing an email is the paid Apollo-credit step.

3. **Per-company research.**  
   Hybrid retrieval runs Exa first, with Tavily as a fallback only when Exa returns no usable results. Claude synthesizes a structured company dossier that is cached on the Company row.

4. **Personalized fit angle.**  
   Sparrow picks one feature line from that set that matches one relevant fit angle based on your resume context.

5. **Email generation.**  
   Templates default to verbatim: Sparrow fills merge tags, including `{{feature_line}}` and `{{fit_angle}}`, without rewriting the authored body. Users can opt a template into Claude rewrite mode, or generate an AI draft without a template.

6. **Send via your Gmail.**  
   Drafts are sent through your own Gmail account using Google OAuth and the Gmail API.

## Quick start

Requires Node 20+, a Supabase project, and a configured Google OAuth client.

```bash
git clone https://github.com/cx18121/sparrow.git
cd sparrow
npm install
cp .env.example .env
```

Fill in `.env` (see `.env.example` for the full list and inline setup notes). Required:

- Supabase: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (client) and `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (server)
- `ENCRYPTION_KEY` (`openssl rand -base64 48`)
- Google OAuth: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_OAUTH_STATE_SECRET`
- `APP_ORIGIN` (required in production — the public app origin used for OAuth redirects)
- `ANTHROPIC_API_KEY` (Claude key for draft generation and LLM enrichment)
- `APOLLO_API_KEY` (free search + paid reveal; required by `/api/apollo-search`)
- `EXA_API_KEY` (primary research retrieval)
- `TAVILY_API_KEY` (fallback retrieval; optional but recommended)
- `DATABASE_URL` + `DIRECT_URL` pointing at your Supabase project

Start the local Supabase stack (requires Docker), then push the schema and activate the pre-push hook:

```bash
supabase start
npx prisma generate
npm run db:push:local
git config core.hooksPath .githooks   # one-time per clone
```

For prod schema changes, use `npm run db:migrate:create` + `npm run db:migrate:deploy` — never `prisma db push`. See `CLAUDE.md` § Database migrations.

In two terminals:

```bash
npm run dev            # frontend (Vite, http://localhost:5173)
npm run dev:api:local  # API (tsx watch local-api.ts) — use this without a linked Vercel project
# or:
npm run dev:api        # API (vercel dev) — use this if you have a linked Vercel project
```
