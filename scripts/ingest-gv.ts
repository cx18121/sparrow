import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// GV (Google Ventures) portfolio — public Sanity CMS API. Two doc types:
// "company" and "aiCompany".

const SANITY_API = "https://v5ygm6ip.api.sanity.io/v2021-10-21/data/query/production";

interface GVCompany {
  name?: string;
  website?: string;
  sector?: { title?: string } | null;
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

const gvAdapter: IngestorAdapter = {
  name: "GV",
  source: "gv",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const [companies, aiCompanies] = await Promise.all([
      fetchType("company"),
      fetchType("aiCompany"),
    ]);
    const all = [...companies, ...aiCompanies];

    const out: CompanyRecord[] = [];
    for (const c of all) {
      if (!c.website || !c.name) continue;
      // GV marks exited (IPO/acquired) companies with a trailing "*" in the
      // CMS name. Skip them — exited companies are absorbed into BigCo and
      // are poor outbound targets. Matches sequoia/greylock exit handling.
      if (/\*\s*$/.test(c.name)) continue;
      const industry = c.sector?.title ?? null;
      out.push({
        name: c.name,
        website: c.website,
        industry,
        topics: industry ? [industry] : undefined,
        investors: ["gv"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    return out;
  },
};

export async function ingestGV(): Promise<void> {
  await runIngestor(gvAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestGV().finally(() => prisma.$disconnect()).catch(console.error);
}
