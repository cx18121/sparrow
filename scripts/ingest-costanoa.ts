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
//   - data.text_cells          → array of {caption, text} cells; the cell
//                                captioned "COSTANOA'S Initial investment"
//                                holds the stage at investment (Seed,
//                                Series A, Series B, …). Other cells are
//                                follow-on rounds. We use the
//                                initial-investment stage as the canonical
//                                Company.stage — that's "what stage was the
//                                company when Costanoa first backed it,"
//                                which matches the modeling other VC
//                                adapters apply.
//
// Costanoa exposes no exit / status field — they're early-stage focused
// and don't publish post-investment outcomes via this Prismic API. Cross-
// source dedupe in runIngestor will absorb overlap with later-stage sources
// that DO mark exits.

const PRISMIC_ROOT = "https://costanoa.cdn.prismic.io/api/v2";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface PrismicRef {
  ref: string;
  isMasterRef?: boolean;
}

interface PrismicTextCell {
  caption?: string | null;
  text?: string | null;
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
    // Array of {caption, text} cells for the per-company sidebar table.
    // The cell captioned "COSTANOA'S Initial investment" holds the
    // entry-round stage; other cells are follow-on rounds.
    text_cells?: PrismicTextCell[];
  };
}

// Normalize raw Costanoa stage text ("Series A", " Series C", "Seed",
// "Pre-Seed", "pre-seed", …) to the canonical CANONICAL_STAGES form.
// Returns null for empty or non-canonical strings.
function normalizeCostanoaStage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^Series [A-F]\+?$/i.test(t)) {
    // Capitalize "series" if author used lowercase; the regex covers both forms.
    return "Series " + t.slice(7).toUpperCase();
  }
  if (/^Pre-?Seed$/i.test(t)) return "Pre-Seed";
  if (/^Seed$/i.test(t)) return "Seed";
  return null;
}

// Pull the entry-round stage from data.text_cells. Prefers the cell
// captioned "COSTANOA'S Initial investment" (case-insensitive, smart-quote
// tolerant); falls back to the first cell whose text normalizes to a
// canonical stage.
function stageFromTextCells(cells: PrismicTextCell[] | undefined): string | null {
  if (!cells || cells.length === 0) return null;
  for (const c of cells) {
    const caption = c.caption?.toLowerCase();
    if (caption && /initial investment/.test(caption)) {
      const s = normalizeCostanoaStage(c.text);
      if (s) return s;
    }
  }
  // Fallback: first cell whose text resolves to a canonical stage.
  for (const c of cells) {
    const s = normalizeCostanoaStage(c.text);
    if (s) return s;
  }
  return null;
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
    let withStage = 0;
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

      const stage = stageFromTextCells(d.text_cells);
      if (stage) withStage++;

      out.push({
        name,
        website,
        oneLiner: d.slogan?.trim() || null,
        stage,
        investors: ["costanoa"],
        signals: ["vc-backed"],
        topics,
        isVerified: true,
      });
    }

    console.log(
      `[Costanoa] fetchAndParse DONE: ${out.length} kept of ${docs.length} docs — ` +
        `${missingName} no-name, ${missingUrl} no-url, ${withStage} with stage`
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
