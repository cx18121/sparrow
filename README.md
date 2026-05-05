# Sparrow

Cold email automation that personalizes emails using live web research and your resume.

> Live at [usesparrow.dev](https://ussparrow.dev).

Built for students doing cold outreach towards startups where the difference between "another cold email" and "actual reply" is whether the message references something specific and recent about the company.

Sparrow does that automatically. All you have to do is pick a contact and pick a template, and then each email draft is created with its own personalized angle based on the selected company, using context from your resume.

## How it works

1. **Pick a startup.**  
   Filter ~6.3k verified companies by tags (sector, tech, stage, investor, region). Sources include YC, a16z, Sequoia, Kleiner Perkins, Greylock, other VC firms, and other startup lists.

2. **Find contacts.**  
   Contact information and emails are found via Apollo.

3. **Per-company research.**  
   Hybrid retrieval runs Exa first (to find recent company info, filtered to ~6 months) with Tavily search as a fallback if no recent info surfaces. Claude creates a structured set of products and recent launches per company.

4. **Personalized fit angle.**  
   Sparrow picks one feature line from that set that matches one relevant fit angle based on your resume context.

5. **Email generation.**  
   Claude generates an email using those personalized elements.

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
