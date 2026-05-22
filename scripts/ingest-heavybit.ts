import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Heavybit portfolio at https://www.heavybit.com/portfolio.
// The portfolio page is hydrated client-side from a public Sanity dataset
// (projectId=50q6fr1p, dataset=production). One GROQ query returns the full
// 80-company portfolio with structured fields — no HTML scraping required.
//
// Sanity API call:
//   GET https://50q6fr1p.apicdn.sanity.io/v2024-10-01/data/query/production
//       ?query=*[_type=="organization" && portfolioCompany==true]{...}
//
// Per-document fields used:
//   - name           → name
//   - link           → website (~2 rows have null link; drop them)
//   - description    → oneLiner
//   - status         → "active" | "acquired" | "exited" | "ipo" | "stealth"
//                      Filter to "active" only — Heavybit labels exits
//                      explicitly so no PREEXISTING_PUBLICS skiplist needed.
//   - joined         → ignored (date string, no stage signal)
//   - slug.current   → sourceId
//
// Status distribution (probe 2026-05-21): 42 active, 31 acquired, 5 exited,
// 1 ipo, 1 stealth. After exit filter + null-link drop: ~40 ingestable rows.
//
// Heavybit is devtools-only by thesis ("Open Source Cloud" → infra/devtools),
// so all rows ingest with industry="Developer Tools" — high target relevance
// for Sparrow's typical engineering-cold-email audience, though heavy overlap
// with a16z/Sequoia/Insight rosters is expected (the well-known devtools
// names are already in our DB).
//
// No stage data on the surface — every row ingests with stage=null, same
// shape as Khosla/IVP/Insight/Greycroft.

const SANITY_PROJECT = "50q6fr1p";
const SANITY_DATASET = "production";
const SANITY_API_VERSION = "v2024-10-01";

const GROQ = `*[_type=="organization" && portfolioCompany==true]{
  name,
  link,
  description,
  status,
  "slug": slug.current
}`;

interface SanityOrg {
  name: string | null;
  link: string | null;
  description: string | null;
  status: string | null;
  slug: string | null;
}

interface SanityResponse {
  result: SanityOrg[];
}

export const heavybitAdapter: IngestorAdapter = {
  name: "Heavybit",
  source: "heavybit",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const url = `https://${SANITY_PROJECT}.apicdn.sanity.io/${SANITY_API_VERSION}/data/query/${SANITY_DATASET}`;
    console.log(`[Heavybit] GET ${url} (GROQ for portfolio orgs)`);

    const { data } = await axios.get<SanityResponse>(url, {
      params: { query: GROQ },
      timeout: 30_000,
    });

    const rows = data.result ?? [];
    console.log(`[Heavybit] Sanity returned ${rows.length} portfolio orgs`);

    const out: CompanyRecord[] = [];
    let nonActive = 0;
    let noLink = 0;
    let noName = 0;

    for (const r of rows) {
      if (!r.name) {
        noName++;
        continue;
      }
      // Active-only filter — Heavybit labels exits explicitly.
      if ((r.status ?? "").toLowerCase() !== "active") {
        nonActive++;
        continue;
      }
      if (!r.link || !/^https?:\/\//i.test(r.link)) {
        noLink++;
        continue;
      }

      out.push({
        name: r.name,
        website: r.link,
        oneLiner: r.description ?? null,
        industry: "Developer Tools",
        investors: ["heavybit"],
        signals: ["vc-backed"],
        sourceId: r.slug ?? null,
        isVerified: true,
      });
    }

    console.log(
      `[Heavybit] fetchAndParse DONE: ${out.length} kept — ` +
        `${nonActive} exits/stealth, ${noLink} no-link, ${noName} no-name`
    );
    return out;
  },
};

export async function ingestHeavybit(): Promise<void> {
  await runIngestor(heavybitAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestHeavybit().finally(() => prisma.$disconnect()).catch(console.error);
}
