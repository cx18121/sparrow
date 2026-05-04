import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// First Round Capital portfolio — public Sanity CMS API.

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
  initialPartnership?: string;
  categories?: string[];
  locations?: string[];
}

const firstRoundAdapter: IngestorAdapter = {
  name: "FirstRound",
  source: "firstround",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { data } = await axios.get(
      `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${SANITY_DATASET}`,
      { params: { query: SANITY_QUERY }, timeout: 20_000 }
    );

    const companies: FRCompany[] = data.result ?? [];
    const out: CompanyRecord[] = [];
    for (const c of companies) {
      if (!c.website) continue;
      // FR uses a trailing "*" in title for exited companies — same convention
      // as GV. Skip; exited targets aren't outbound prospects.
      if (c.title && /\*\s*$/.test(c.title)) continue;
      const location = c.locations?.filter((l) => l && l !== "Other").join(", ") || null;
      out.push({
        name: c.title ?? "",
        website: c.website,
        stage: c.initialPartnership ?? null,
        industry: c.categories?.[0] ?? null,
        location,
        sourceId: c.slug?.current ?? c._id,
        topics: c.categories,
        investors: ["firstround"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    return out;
  },
};

export async function ingestFirstRound(): Promise<void> {
  await runIngestor(firstRoundAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestFirstRound().finally(() => prisma.$disconnect()).catch(console.error);
}
