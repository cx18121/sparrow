import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Accel portfolio — public Algolia search index. Read-only key is intentionally
// public in Accel's JS bundle. Filter: current-status === true.

const ALGOLIA_APP_ID = "J60GRWQY2U";
const ALGOLIA_API_KEY = "83fd461ed9ef96bf7d972a8029970435";
const ALGOLIA_INDEX = "relationships-index";
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;

interface AccelHit {
  name?: string;
  slug?: string;
  "website-url"?: string;
  "short-description"?: string;
  "long-description"?: string;
  sectors?: string[];
  "cb-sectors"?: string[];
  region?: string[];
  headquarters?: string;
  location?: string;
  "initial-investment-type"?: string;
  "current-status"?: boolean;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

// Accel tags each company with the initial-investment-type from their CMS:
// values include "Seed", "Series A", … "Series C", "Early", "Growth". The
// previous mapping sent "Growth" to "Series B" even though "Series C+" is
// the actual bucket for Accel's growth-fund investments. See
// docs/scraping-research.md.
function mapStage(investmentType: string | undefined): string | null {
  if (!investmentType) return null;
  const s = investmentType.toLowerCase();
  if (s.includes("seed")) return "Seed";
  if (s.includes("series a")) return "Series A";
  if (s.includes("series b")) return "Series B";
  if (s.includes("series c")) return "Series C+";
  if (s.includes("early")) return "Seed";
  if (s.includes("growth")) return "Series C+";
  return investmentType;
}

const accelAdapter: IngestorAdapter = {
  name: "Accel",
  source: "accel",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { data } = await axios.post(
      ALGOLIA_URL,
      { query: "", hitsPerPage: 1000, filters: "current-status:true" },
      {
        headers: {
          "X-Algolia-Application-Id": ALGOLIA_APP_ID,
          "X-Algolia-API-Key": ALGOLIA_API_KEY,
          "Content-Type": "application/json",
        },
        timeout: 20_000,
      }
    );

    const hits: AccelHit[] = data.hits ?? [];
    const out: CompanyRecord[] = [];
    for (const h of hits) {
      const website = h["website-url"];
      if (!website) continue;
      const rawDescription = h["short-description"] || h["long-description"] || "";
      const description = rawDescription ? stripHtml(rawDescription) : null;
      out.push({
        name: h.name ?? "",
        website,
        oneLiner: description?.slice(0, 200) ?? null,
        stage: mapStage(h["initial-investment-type"]),
        industry: h.sectors?.[0] ?? null,
        location: h.headquarters || h.location || null,
        sourceId: h.slug ?? null,
        topics: [...(h.sectors ?? []), ...(h["cb-sectors"] ?? [])],
        investors: ["accel"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    return out;
  },
};

export async function ingestAccel(): Promise<void> {
  await runIngestor(accelAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestAccel().finally(() => prisma.$disconnect()).catch(console.error);
}
