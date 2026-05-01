import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// First Round Capital portfolio — 191 companies via their public Sanity CMS API.
// No auth required. Returns all companies in one request with resolved references.

const SANITY_PROJECT_ID = "m6i10uln";
const SANITY_DATASET = "production";
const SANITY_API_VERSION = "2024-01-01";
const SANITY_QUERY = `*[_type=="company"]{
  _id,
  title,
  slug,
  website,
  initialPartnership,
  "categories":companyCategories[]->title,
  "locations":companyLocations[]->title
}`;

interface FRCompany {
  _id: string;
  title?: string;
  slug?: { current: string };
  website?: string;
  initialPartnership?: string; // "Pre-Seed" | "Seed" | "Series A" | ...
  categories?: string[];
  locations?: string[];
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function ingestFirstRound(): Promise<void> {
  let companies: FRCompany[];

  try {
    const { data } = await axios.get(
      `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${SANITY_DATASET}`,
      { params: { query: SANITY_QUERY }, timeout: 20_000 }
    );
    companies = data.result ?? [];
  } catch (err: any) {
    console.error(`[FirstRound] Sanity API request failed: ${err.message}`);
    return;
  }

  console.log(`[FirstRound] ${companies.length} portfolio companies`);

  let ingested = 0;
  let skipped = 0;

  for (const c of companies) {
    if (!c.website) { skipped++; continue; }

    const domain = extractDomain(c.website);
    if (!domain || isFreeHostingDomain(domain)) { skipped++; continue; }

    const location = c.locations?.filter(l => l && l !== "Other").join(", ") || null;
    const tags = buildTags({
      topics: c.categories,
      industry: c.categories?.[0] ?? undefined,
      stage: c.initialPartnership,
      investors: ["firstround"],
      signals: ["vc-backed"],
    });
    const qualityScore = computeQualityScore({
      isVerified: true,
      stage: c.initialPartnership,
      industry: c.categories?.[0] ?? null,
    });

    try {
      await upsertCompany({
        domain,
        name: c.title ?? domain,
        website: c.website,
        stage: c.initialPartnership ?? null,
        industry: c.categories?.[0] ?? null,
        location,
        source: "firstround",
        sourceId: c.slug?.current ?? c._id,
        tags,
        isVerified: true,
        qualityScore,
      });
      ingested++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[FirstRound] Failed "${c.title}": ${msg}`);
    }
  }

  console.log(`[FirstRound] Ingested ${ingested}, skipped ${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestFirstRound().finally(() => prisma.$disconnect()).catch(console.error);
}
