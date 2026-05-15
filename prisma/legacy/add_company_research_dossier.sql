-- Cache the per-company research output from researchCompanyDossier so multiple
-- emails to the same company (and follow-up sends weeks later) reuse the same
-- web-search work. The dossier is structured JSON and the per-user fit-angle
-- pick happens on top of it without web search. See server/lib/ai/research-fit-angle.ts.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "researchDossier" JSONB;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "researchedAt" TIMESTAMP(3);
