import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

const YC_API_URL = "https://yc-oss.github.io/api/companies/all.json";

interface YCCompany {
  name: string;
  website: string | null;
  all_locations: string;
  // YC's API also exposes a structured `regions` array (e.g.
  // ["United Kingdom","Europe","Remote","Partly Remote"]). For ~95% of
  // companies that have empty `all_locations`, regions[] still has signal —
  // we use it as a fallback to fill location/region.
  regions?: string[];
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

// Synthesize a location string from YC's `regions` array when `all_locations`
// is empty. Prefer country/continent over remote markers — "Remote + UK" is
// more useful as "United Kingdom" than as "Remote".
function locationFromRegions(regions: string[] | undefined): string | null {
  if (!regions || regions.length === 0) return null;
  const real = regions.filter(r => r && r !== "Unspecified");
  if (real.length === 0) return null;
  const REMOTE = new Set(["Remote", "Partly Remote"]);
  const nonRemote = real.find(r => !REMOTE.has(r));
  if (nonRemote) return nonRemote;
  if (real.some(r => REMOTE.has(r))) return "Remote";
  return null;
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

// Batch format changed from "W18"/"S18" to "Winter 2018"/"Summer 2018".
function parseBatchYear(batch: string): number {
  const fourDigit = batch.match(/\b(20\d{2})\b/);
  if (fourDigit) return parseInt(fourDigit[1], 10) % 100;
  const twoDigit = batch.match(/[WS](\d+)/i);
  if (twoDigit) return parseInt(twoDigit[1], 10);
  return 0;
}

const ycAdapter: IngestorAdapter = {
  name: "YC",
  source: "yc",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const MIN_BATCH_YEAR = 18;
    const MAX_HEADCOUNT = 150;

    const response = await axios.get<YCCompany[]>(YC_API_URL);
    const companies = response.data;

    const out: CompanyRecord[] = [];
    for (const c of companies) {
      if (c.status !== "Active" || !c.website) continue;
      if (c.team_size > MAX_HEADCOUNT) continue;
      if (parseBatchYear(c.batch) < MIN_BATCH_YEAR) continue;

      const stage = mapYCStage(c.stage);
      const location = c.all_locations?.trim() || locationFromRegions(c.regions);
      out.push({
        website: c.website,
        name: c.name,
        description: c.long_description || null,
        oneLiner: c.one_liner,
        stage,
        industry: c.industry,
        subIndustry: c.subindustry,
        location,
        headcount: c.team_size,
        isHiring: c.isHiring,
        batch: c.batch,
        sourceId: c.slug,
        topics: c.subindustry ? [c.subindustry] : undefined,
        signals: ["yc-backed"],
        isVerified: true,
      });
    }

    console.log(
      `[YC] Fetched ${companies.length} total, ${out.length} active (headcount ≤ ${MAX_HEADCOUNT}, batch ≥ W${MIN_BATCH_YEAR})`
    );
    return out;
  },
};

export async function ingestYC(): Promise<void> {
  await runIngestor(ycAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestYC().finally(() => prisma.$disconnect()).catch(console.error);
}
