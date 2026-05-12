import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Costanoa Ventures portfolio at https://costanoa.vc/portfolio.
// The site is Nuxt fed by a publicly-readable Prismic CMS API at
// https://costanoa.cdn.prismic.io/api/v2. The /portfolio page renders a
// `company` document collection, so we bypass the HTML entirely and pull
// directly from Prismic's REST search endpoint — two HTTP calls total:
//
//   1. GET /api/v2                        — returns the current master ref
//   2. GET /api/v2/documents/search?ref=<master>&q=[[at(document.type,"company")]]&pageSize=100
//                                         — 97 results in a single page
//
// Per-company fields (richer than any other source so far):
//   - data.name                → name
//   - data.slogan              → tagline (used as oneLiner)
//   - data.external_link.url   → website
//   - data.filter_category     → sector (kept as a topic tag)
//
// Costanoa exposes no exit / status field — they're early-stage focused
// and don't publish post-investment outcomes via this Prismic API. Cross-
// source dedupe in runIngestor will absorb overlap with later-stage sources
// that DO mark exits. No stage data either, so every row ingests with
// stage=null — same shape as Khosla/Initialized/IVP/Insight.

const PRISMIC_ROOT = "https://costanoa.cdn.prismic.io/api/v2";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface PrismicRef {
  ref: string;
  isMasterRef?: boolean;
}

interface PrismicCompanyDoc {
  data?: {
    name?: string;
    slogan?: string | null;
    external_link?: { url?: string } | null;
    // Prismic returns this as a string for most company docs but as
    // `null`/`undefined`/an empty object for a few — type as unknown and
    // narrow at the use site.
    filter_category?: unknown;
  };
}

interface PrismicSearchResponse {
  total_pages: number;
  total_results_size: number;
  next_page: string | null;
  results: PrismicCompanyDoc[];
}

async function fetchMasterRef(): Promise<string> {
  const { data } = await axios.get<{ refs?: PrismicRef[] }>(PRISMIC_ROOT, {
    headers: { "User-Agent": UA },
    timeout: 20_000,
  });
  const master = data.refs?.find((r) => r.isMasterRef);
  if (!master?.ref) throw new Error("Prismic master ref missing");
  return master.ref;
}

async function fetchCompanyPage(ref: string, page: number): Promise<PrismicSearchResponse> {
  const { data } = await axios.get<PrismicSearchResponse>(
    `${PRISMIC_ROOT}/documents/search`,
    {
      params: {
        ref,
        q: '[[at(document.type,"company")]]',
        pageSize: 100,
        page,
      },
      headers: { "User-Agent": UA },
      timeout: 30_000,
    }
  );
  return data;
}

export const costanoaAdapter: IngestorAdapter = {
  name: "Costanoa",
  source: "costanoa",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const ref = await fetchMasterRef();
    console.log(`[Costanoa] master ref: ${ref}`);

    // Prismic's pageSize caps at 100. Walk pages until exhausted — typically
    // a single page (Costanoa's collection is currently 97).
    const docs: PrismicCompanyDoc[] = [];
    let page = 1;
    while (true) {
      const resp = await fetchCompanyPage(ref, page);
      docs.push(...resp.results);
      console.log(
        `[Costanoa] page ${page}/${resp.total_pages}: +${resp.results.length} (total ${docs.length}/${resp.total_results_size})`
      );
      if (page >= resp.total_pages) break;
      page++;
    }

    const out: CompanyRecord[] = [];
    let missingName = 0;
    let missingUrl = 0;
    for (const doc of docs) {
      const d = doc.data;
      if (!d) continue;
      const name = d.name?.trim();
      const website = d.external_link?.url?.trim();
      if (!name) { missingName++; continue; }
      if (!website || !/^https?:\/\//i.test(website)) { missingUrl++; continue; }

      const topics: string[] = [];
      if (typeof d.filter_category === "string" && d.filter_category.trim()) {
        topics.push(d.filter_category.trim());
      }

      out.push({
        name,
        website,
        oneLiner: d.slogan?.trim() || null,
        investors: ["costanoa"],
        signals: ["vc-backed"],
        topics,
        isVerified: true,
      });
    }

    console.log(
      `[Costanoa] fetchAndParse DONE: ${out.length} kept of ${docs.length} docs — ` +
        `${missingName} no-name, ${missingUrl} no-url`
    );
    return out;
  },
};

export async function ingestCostanoa(): Promise<void> {
  await runIngestor(costanoaAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestCostanoa().finally(() => prisma.$disconnect()).catch(console.error);
}
