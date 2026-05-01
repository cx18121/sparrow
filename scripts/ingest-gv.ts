import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// GV (Google Ventures) portfolio — 748 companies via public Sanity CMS API.
// No auth required; project is public-read.

const SANITY_API = "https://v5ygm6ip.api.sanity.io/v2021-10-21/data/query/production";

interface GVCompany {
  name?: string;
  website?: string;
  sector?: { title?: string } | null;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}

async function fetchType(type: string): Promise<GVCompany[]> {
  const all: GVCompany[] = [];
  let offset = 0;
  const size = 100;

  while (true) {
    const query = `*[_type=="${type}"]{name, website, "sector": sector->{title}}[${offset}..${offset + size - 1}]`;
    try {
      const { data } = await axios.get(SANITY_API, { params: { query }, timeout: 15_000 });
      const batch: GVCompany[] = data.result ?? [];
      all.push(...batch);
      if (batch.length < size) break;
      offset += size;
    } catch (err: any) {
      console.error(`[GV] Sanity API failed at offset ${offset}: ${err.message}`);
      break;
    }
  }
  return all;
}

export async function ingestGV(): Promise<void> {
  const [companies, aiCompanies] = await Promise.all([fetchType("company"), fetchType("aiCompany")]);
  const all = [...companies, ...aiCompanies];
  console.log(`[GV] ${all.length} portfolio companies`);

  let ingested = 0, skipped = 0;

  for (const c of all) {
    if (!c.website) { skipped++; continue; }
    const domain = extractDomain(c.website);
    if (!domain || isFreeHostingDomain(domain)) { skipped++; continue; }

    const industry = c.sector?.title ?? null;
    const tags = buildTags({ topics: industry ? [industry] : undefined, industry: industry ?? undefined, investors: ["gv"], signals: ["vc-backed"] });
    const qualityScore = computeQualityScore({ isVerified: true, industry });

    try {
      await upsertCompany({
        domain, name: c.name ?? domain, website: c.website,
        industry, source: "gv", sourceId: domain,
        tags, isVerified: true, qualityScore,
      });
      ingested++;
    } catch (err) {
      console.error(`[GV] Failed "${c.name}": ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[GV] Ingested ${ingested}, skipped ${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestGV().finally(() => prisma.$disconnect()).catch(console.error);
}
