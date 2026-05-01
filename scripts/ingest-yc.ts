import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

const YC_API_URL = "https://yc-oss.github.io/api/companies/all.json";

interface YCCompany {
  name: string;
  website: string | null;
  all_locations: string;
  team_size: number;
  industry: string;
  subindustry: string;
  stage: string;
  isHiring: boolean;
  batch: string;
  status: string;
  one_liner: string;
  long_description: string;
  slug: string;
}

function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function mapYCStage(ycStage: string): string {
  switch (ycStage) {
    case "Early":
      return "Seed";
    case "Growth":
      return "Series A";
    case "Late":
      return "Series C+";
    default:
      return ycStage;
  }
}

export async function ingestYC(): Promise<void> {
  const response = await axios.get<YCCompany[]>(YC_API_URL);
  const companies: YCCompany[] = response.data;

  const MIN_BATCH_YEAR = 18; // drop batches before 2018
  const MAX_HEADCOUNT = 150;

  // Batch format changed from "W18"/"S18" to "Winter 2018"/"Summer 2018"
  const parseBatchYear = (batch: string): number => {
    const fourDigit = batch.match(/\b(20\d{2})\b/);
    if (fourDigit) return parseInt(fourDigit[1], 10) % 100;
    const twoDigit = batch.match(/[WS](\d+)/i);
    if (twoDigit) return parseInt(twoDigit[1], 10);
    return 0;
  };

  const active = companies.filter((c) => {
    if (c.status !== "Active" || !c.website) return false;
    if (c.team_size > MAX_HEADCOUNT) return false;
    const batchYear = parseBatchYear(c.batch);
    if (batchYear < MIN_BATCH_YEAR) return false;
    return true;
  });

  console.log(
    `Fetched ${companies.length} total, ${active.length} active startups (headcount ≤ ${MAX_HEADCOUNT}, batch ≥ W${MIN_BATCH_YEAR})`
  );

  let count = 0;
  for (const company of active) {
    const domain = extractDomain(company.website!);
    if (!domain || isFreeHostingDomain(domain)) continue;

    const stage = mapYCStage(company.stage);
    const tags = buildTags({
      industry: company.industry,
      topics: company.subindustry ? [company.subindustry] : undefined,
      stage,
      headcount: company.team_size,
      signals: ["yc-backed"],
    });
    const qualityScore = computeQualityScore({
      isVerified: true,
      headcount: company.team_size,
      stage,
      isHiring: company.isHiring,
      industry: company.industry,
    });

    try {
      await upsertCompany({
        domain,
        name: company.name,
        description: company.long_description || null,
        oneLiner: company.one_liner,
        website: company.website,
        stage,
        industry: company.industry,
        subIndustry: company.subindustry,
        location: company.all_locations,
        headcount: company.team_size,
        isHiring: company.isHiring,
        batch: company.batch,
        source: "yc",
        sourceId: company.slug,
        tags,
        isVerified: true,
        qualityScore,
      });
      count++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to upsert ${company.name}: ${msg}`);
    }
  }

  console.log(`Ingested ${count} YC companies`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestYC().finally(() => prisma.$disconnect()).catch(console.error);
}
