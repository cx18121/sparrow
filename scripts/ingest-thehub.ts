import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// The Hub (thehub.io) — Nordic startup ecosystem.
// API moved to api.thehub.io/companies with new field names.

const BASE_URL = "https://api.thehub.io/companies";

interface HubStartup {
  id: string;
  key?: string;
  name: string;
  website?: string;
  whatWeDo?: string;
  numberOfEmployees?: string; // "1-10", "11-50", "51-200", etc.
  fundingStage?: string;      // "seed", "preSeed", "seriesA", "bootstrapped", "notLooking", etc.
  industries?: string[];
  numberOfActiveJobs?: number;
  countries?: Array<{ location?: { country?: string } }>;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}

function parseHeadcount(range: string | undefined): number | null {
  if (!range) return null;
  const match = range.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function mapFundingStage(stage: string | undefined): string | null {
  if (!stage) return null;
  const s = stage.toLowerCase();
  if (s === "preseed" || s === "pre-seed" || s === "bootstrapped") return "Pre-Seed";
  if (s === "seed") return "Seed";
  if (s === "seriesa" || s === "series a") return "Series A";
  if (s === "seriesb" || s === "series b") return "Series B";
  if (s === "seriesc" || s === "series c" || s === "late") return "Series C+";
  if (s === "notlooking" || s === "not looking") return null;
  return null;
}

export async function ingestTheHub(maxPages = 30): Promise<void> {
  let page = 1;
  let totalPages = 1;
  let ingested = 0;
  let fetched = 0;

  while (page <= Math.min(maxPages, totalPages)) {
    let startups: HubStartup[];

    try {
      const { data } = await axios.get(BASE_URL, {
        params: { page, limit: 50 },
        headers: { Accept: "application/json" },
        timeout: 15_000,
      });
      if (page === 1) {
        totalPages = data.pages ?? 1;
        console.log(`[TheHub] ${data.total ?? "?"} companies across ${totalPages} pages`);
      }
      startups = data.docs ?? [];
    } catch (err: any) {
      console.error(`[TheHub] Request failed (page ${page}): ${err.message}`);
      break;
    }

    if (!startups.length) break;
    fetched += startups.length;

    for (const s of startups) {
      if (!s.website) continue;
      const domain = extractDomain(s.website);
      if (!domain || isFreeHostingDomain(domain)) continue;

      const stage = mapFundingStage(s.fundingStage);
      const headcount = parseHeadcount(s.numberOfEmployees);
      const isHiring = (s.numberOfActiveJobs ?? 0) > 0;
      const location = s.countries?.[0]?.location?.country ?? null;
      const industry = s.industries?.[0] ?? null;

      const tags = buildTags({ topics: s.industries, industry: industry ?? undefined, headcount, stage });
      const qualityScore = computeQualityScore({ isVerified: true, headcount, stage, isHiring, industry });

      try {
        await upsertCompany({
          domain,
          name: s.name,
          oneLiner: s.whatWeDo?.trim().slice(0, 200) ?? null,
          website: s.website,
          stage,
          industry,
          location,
          headcount,
          isHiring,
          source: "thehub",
          sourceId: s.key ?? s.id,
          tags,
          isVerified: true,
          qualityScore,
        });
        ingested++;
      } catch (err) {
        console.error(`[TheHub] Failed ${s.name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    page++;
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`[TheHub] Fetched ${fetched} startups, ingested ${ingested}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestTheHub().finally(() => prisma.$disconnect()).catch(console.error);
}
