import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// Accel portfolio — 746 companies via their public Algolia search index.
// The read-only API key is hardcoded in Accel's public JS bundle (intentionally public).
// Filter: current-status === true (excludes exited/acquired companies).

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
  "initial-investment"?: string;
  "initial-investment-type"?: string;
  "first-invest-date"?: string;
  "current-status"?: boolean;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function mapStage(investmentType: string | undefined): string | null {
  if (!investmentType) return null;
  const s = investmentType.toLowerCase();
  if (s.includes("seed")) return "Seed";
  if (s.includes("series a")) return "Series A";
  if (s.includes("series b")) return "Series B";
  if (s.includes("series c")) return "Series C+";
  if (s.includes("early")) return "Seed";
  if (s.includes("growth")) return "Series B";
  return investmentType;
}

export async function ingestAccel(): Promise<void> {
  let hits: AccelHit[];

  try {
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
    hits = data.hits ?? [];
  } catch (err: any) {
    console.error(`[Accel] Algolia request failed: ${err.message}`);
    return;
  }

  console.log(`[Accel] ${hits.length} active portfolio companies`);

  let ingested = 0;
  let skipped = 0;

  for (const h of hits) {
    const website = h["website-url"];
    if (!website) { skipped++; continue; }

    const domain = extractDomain(website);
    if (!domain || isFreeHostingDomain(domain)) { skipped++; continue; }

    const rawDescription = h["short-description"] || h["long-description"] || "";
    const description = rawDescription ? stripHtml(rawDescription) : null;
    const stage = mapStage(h["initial-investment-type"]);
    const location = h.headquarters || h.location || null;
    const topics = [...(h.sectors ?? []), ...(h["cb-sectors"] ?? [])];

    const tags = buildTags({
      topics,
      industry: h.sectors?.[0] ?? undefined,
      stage,
      investors: ["accel"],
      signals: ["vc-backed"],
    });

    const qualityScore = computeQualityScore({
      isVerified: true,
      stage,
      industry: h.sectors?.[0] ?? null,
    });

    try {
      await upsertCompany({
        domain,
        name: h.name ?? domain,
        oneLiner: description?.slice(0, 200) ?? null,
        website,
        stage,
        industry: h.sectors?.[0] ?? null,
        location,
        source: "accel",
        sourceId: h.slug ?? domain,
        tags,
        isVerified: true,
        qualityScore,
      });
      ingested++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Accel] Failed "${h.name}": ${msg}`);
    }
  }

  console.log(`[Accel] Ingested ${ingested}, skipped ${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestAccel().finally(() => prisma.$disconnect()).catch(console.error);
}
