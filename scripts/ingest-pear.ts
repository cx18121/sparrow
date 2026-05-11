import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Pear VC portfolio via WordPress REST API. The `pear_vc_company` custom
// post type carries current_stage and pear_vc_company_sector as arrays of
// taxonomy term IDs; we fetch each taxonomy once at startup to resolve IDs
// to human-readable labels. Skips Acquired and IPO companies via the
// current_stage taxonomy. Website preference is meta.website_url then
// link, rejecting pear.vc URLs (some "links" point to Pear's own
// announcement posts rather than the company's site).

const WP_BASE = "https://pear.vc/wp-json/wp/v2";
const REQUEST_DELAY_MS = 300;

interface PearCompany {
  id: number;
  slug: string;
  title: { rendered: string };
  link: string;
  meta?: { website_url?: string };
  current_stage?: number[];
  pear_vc_company_sector?: number[];
}

interface TermRecord {
  id: number;
  name: string;
}

async function fetchTaxonomyMap(endpoint: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const { data, headers } = await axios.get<TermRecord[]>(`${WP_BASE}/${endpoint}`, {
      params: { per_page: 100, page },
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 15_000,
    });
    if (page === 1) totalPages = parseInt(headers["x-wp-totalpages"] ?? "1", 10);
    for (const t of data) map.set(t.id, t.name);
    page++;
  }
  return map;
}

function pickExternalUrl(candidates: Array<string | undefined | null>): string | null {
  for (const url of candidates) {
    if (!url) continue;
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host === "pear.vc" || host.endsWith(".pear.vc")) continue;
      return url;
    } catch {
      // Malformed URL — skip.
    }
  }
  return null;
}

const pearAdapter: IngestorAdapter = {
  name: "Pear",
  source: "pear",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const [stageMap, sectorMap] = await Promise.all([
      fetchTaxonomyMap("current_stage"),
      fetchTaxonomyMap("pear_vc_company_sector"),
    ]);
    console.log(`[Pear] taxonomies: ${stageMap.size} stages, ${sectorMap.size} sectors`);

    const companies: PearCompany[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      try {
        const { data, headers } = await axios.get<PearCompany[]>(`${WP_BASE}/pear_vc_company`, {
          params: {
            per_page: 100,
            page,
            _fields: "id,slug,title,link,meta,current_stage,pear_vc_company_sector",
          },
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
          timeout: 20_000,
        });
        if (page === 1) {
          totalPages = parseInt(headers["x-wp-totalpages"] ?? "1", 10);
          console.log(`[Pear] ${headers["x-wp-total"]} companies across ${totalPages} pages`);
        }
        companies.push(...data);
      } catch (err: any) {
        console.error(`[Pear] page ${page}: ${err.message}`);
        break;
      }
      page++;
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }

    const out: CompanyRecord[] = [];
    for (const c of companies) {
      const stageLabels = (c.current_stage ?? [])
        .map((id) => stageMap.get(id))
        .filter((s): s is string => !!s);

      // Skip exits — Pear tags them via the current_stage taxonomy alongside
      // real stages. We don't want to outreach IPO'd or acquired companies.
      const exited = stageLabels.some((s) => {
        const lower = s.toLowerCase();
        return lower === "acquired" || lower === "ipo";
      });
      if (exited) continue;

      const website = pickExternalUrl([c.meta?.website_url, c.link]);
      if (!website) continue;

      const name = c.title.rendered.replace(/<[^>]+>/g, "").trim();
      if (!name) continue;

      const sectors = (c.pear_vc_company_sector ?? [])
        .map((id) => sectorMap.get(id))
        .filter((s): s is string => !!s);

      out.push({
        name,
        website,
        stage: stageLabels[0] ?? null,
        industry: sectors[0] ?? null,
        sourceId: c.slug,
        topics: sectors.length > 0 ? sectors : undefined,
        investors: ["pear"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    return out;
  },
};

export async function ingestPear(): Promise<void> {
  await runIngestor(pearAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestPear().finally(() => prisma.$disconnect()).catch(console.error);
}
