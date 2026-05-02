import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// The Hub (thehub.io) — Nordic startup ecosystem.
// API at api.thehub.io/companies, paginated.

const BASE_URL = "https://api.thehub.io/companies";

interface HubStartup {
  id: string;
  key?: string;
  name: string;
  website?: string;
  whatWeDo?: string;
  numberOfEmployees?: string;
  fundingStage?: string;
  industries?: string[];
  numberOfActiveJobs?: number;
  countries?: Array<{ location?: { country?: string } }>;
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
  return null;
}

function buildAdapter(maxPages: number): IngestorAdapter {
  return {
    name: "TheHub",
    source: "thehub",
    async fetchAndParse(): Promise<CompanyRecord[]> {
      const out: CompanyRecord[] = [];
      let page = 1;
      let totalPages = 1;

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

        for (const s of startups) {
          if (!s.website) continue;
          const stage = mapFundingStage(s.fundingStage);
          out.push({
            website: s.website,
            name: s.name,
            oneLiner: s.whatWeDo?.trim().slice(0, 200) ?? null,
            stage,
            industry: s.industries?.[0] ?? null,
            location: s.countries?.[0]?.location?.country ?? null,
            headcount: parseHeadcount(s.numberOfEmployees),
            isHiring: (s.numberOfActiveJobs ?? 0) > 0,
            sourceId: s.key ?? s.id,
            topics: s.industries,
            isVerified: true,
          });
        }

        page++;
        await new Promise(r => setTimeout(r, 400));
      }

      return out;
    },
  };
}

export async function ingestTheHub(maxPages = 30): Promise<void> {
  await runIngestor(buildAdapter(maxPages));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestTheHub().finally(() => prisma.$disconnect()).catch(console.error);
}
