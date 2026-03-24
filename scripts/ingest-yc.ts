import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";

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
    const hostname = new URL(url).hostname;
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

  const MIN_BATCH_YEAR = 18; // drop batches before W18/S18
  const MAX_HEADCOUNT = 150;

  const active = companies.filter((c) => {
    if (c.status !== "Active" || !c.website) return false;
    if (c.team_size > MAX_HEADCOUNT) return false;
    const batchYear = parseInt(c.batch.slice(1), 10);
    if (isNaN(batchYear) || batchYear < MIN_BATCH_YEAR) return false;
    return true;
  });

  console.log(
    `Fetched ${companies.length} total, ${active.length} active startups (headcount ≤ ${MAX_HEADCOUNT}, batch ≥ W${MIN_BATCH_YEAR})`
  );

  let count = 0;
  for (const company of active) {
    const domain = extractDomain(company.website!);
    if (!domain) continue;

    try {
      await upsertCompany({
        domain,
        name: company.name,
        description: company.long_description,
        oneLiner: company.one_liner,
        website: company.website,
        stage: mapYCStage(company.stage),
        industry: company.industry,
        subIndustry: company.subindustry,
        location: company.all_locations,
        headcount: company.team_size,
        isHiring: company.isHiring,
        batch: company.batch,
        source: "yc",
        sourceId: company.slug,
      });
      count++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to upsert ${company.name}: ${msg}`);
    }
  }

  console.log(`Ingested ${count} YC companies`);
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestYC().catch(console.error);
}
