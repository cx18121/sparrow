import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// Work at a Startup (workatastartup.com) — YC's jobs board.
// The site is Next.js SSR; the full company list is embedded in __NEXT_DATA__
// on the /companies page. No login required to browse.
//
// Filters applied:
//   - Must have a website domain
//   - Domain must not be a free-hosting platform
//   - Recent batches only (MIN_BATCH_YEAR)

const BASE_URL = "https://www.workatastartup.com";
const MIN_BATCH_YEAR = 18; // W18/S18 and later, matching YC ingestor

interface WaasCompany {
  id?: number;
  name?: string;
  slug?: string;
  website?: string;
  one_liner?: string;
  long_description?: string;
  batch?: string;
  company_size?: string; // "1-10", "11-50", "51-200", "201-500", "500+"
  stage?: string | null;
  isHiring?: boolean;
  industry?: string | null;
  subindustry?: string | null;
  location?: string | null;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function parseHeadcount(size: string | undefined): number | null {
  if (!size) return null;
  const match = size.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function batchYear(batch: string | undefined): number {
  if (!batch) return 0;
  const m = batch.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

export async function ingestWorkAtAStartup(): Promise<void> {
  let html: string;
  try {
    const { data } = await axios.get(`${BASE_URL}/companies`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ColdFlowBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      timeout: 20_000,
    });
    html = data as string;
  } catch (err: any) {
    console.error(`[WaaS] Failed to fetch page: ${err.message}`);
    return;
  }

  // Extract __NEXT_DATA__ JSON blob embedded by Next.js SSR
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    console.error("[WaaS] __NEXT_DATA__ not found — page may require login or structure changed");
    return;
  }

  let nextData: any;
  try {
    nextData = JSON.parse(match[1]);
  } catch {
    console.error("[WaaS] Failed to parse __NEXT_DATA__");
    return;
  }

  // Company list can live at several paths depending on WaaS page version
  const pageProps = nextData?.props?.pageProps ?? {};
  const companies: WaasCompany[] =
    pageProps.companies ??
    pageProps.initialCompanies ??
    pageProps.startups ??
    [];

  if (!companies.length) {
    console.warn("[WaaS] No companies found in __NEXT_DATA__ — structure may have changed");
    console.warn("[WaaS] Available pageProps keys:", Object.keys(pageProps));
    return;
  }

  console.log(`[WaaS] Found ${companies.length} companies in initial payload`);

  let ingested = 0;
  let skipped = 0;

  for (const c of companies) {
    if (!c.website) { skipped++; continue; }

    // Filter to recent batches only
    if (c.batch && batchYear(c.batch) < MIN_BATCH_YEAR) { skipped++; continue; }

    const domain = extractDomain(c.website);
    if (!domain || isFreeHostingDomain(domain)) { skipped++; continue; }

    const headcount = parseHeadcount(c.company_size);
    const tags = buildTags({
      industry: c.industry,
      topics: c.subindustry ? [c.subindustry] : undefined,
      stage: c.stage,
      headcount,
      signals: ["yc-backed"],
    });
    const qualityScore = computeQualityScore({
      isVerified: true,
      headcount,
      stage: c.stage,
      isHiring: c.isHiring,
      industry: c.industry,
    });

    try {
      await upsertCompany({
        domain,
        name: c.name ?? domain,
        description: c.long_description ?? null,
        oneLiner: c.one_liner ?? null,
        website: c.website,
        stage: c.stage ?? null,
        industry: c.industry ?? null,
        subIndustry: c.subindustry ?? null,
        location: c.location ?? null,
        headcount,
        isHiring: c.isHiring,
        batch: c.batch ?? null,
        source: "workatastartup",
        sourceId: c.slug ?? String(c.id ?? domain),
        tags,
        isVerified: true,
        qualityScore,
      });
      ingested++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WaaS] Failed "${c.name}": ${msg}`);
    }
  }

  console.log(`[WaaS] Ingested ${ingested}, skipped ${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestWorkAtAStartup().finally(() => prisma.$disconnect()).catch(console.error);
}
