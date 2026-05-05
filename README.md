# Sparrow

Campaign-first cold outreach for students. Sparrow helps users find startup contacts, draft specific emails from their resume/background context, and send reviewed drafts through Gmail.

> Live at [usesparrow.dev](https://usesparrow.dev).

Built for students doing cold outreach towards startups where the difference between "another cold email" and "actual reply" is whether the message references something specific and recent about the company.

Sparrow does the research and drafting work around the user's review loop. Pick a campaign, find contacts, choose or write a template, then generate drafts with per-company context before editing and sending.

## How it works

1. **Pick a startup.**  
   Filter ~6.3k verified companies by tags (sector, tech, stage, investor, region). Sources include YC, a16z, Sequoia, Kleiner Perkins, Greylock, other VC firms, and verified startup lists.

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

Fill in `.env`:

- Supabase URL + anon key + service role key
- `ENCRYPTION_KEY` (`openssl rand -base64 48`)
- Google OAuth client ID + secret + state secret
- `ANTHROPIC_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`
- `DATABASE_URL` + `DIRECT_URL` pointing at your Supabase project

Then:

```bash
npx prisma generate
npx prisma db push
```

In two terminals:

```bash
npm run dev            # frontend (Vite, http://localhost:5173)
npm run dev:api:local  # API (tsx watch local-api.ts)
```
