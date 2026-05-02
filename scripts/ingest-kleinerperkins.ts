import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Kleiner Perkins portfolio — public WordPress REST API. ACF custom fields
// include website, description, sector, and stage taxonomy IDs.
// Filter: acf.timing === "Current".

const WP_BASE = "https://www.kleinerperkins.com/wp-json/wp/v2";

const SECTOR_MAP: Record<number, string> = {
  38: "AI",
  29: "Enterprise",
  33: "Fintech",
  31: "Healthcare",
  30: "Consumer",
  32: "Hardtech",
  39: "Greentech",
  41: "Life Sciences",
};

const STAGE_MAP: Record<number, string | null> = {
  34: "Seed",
  35: "Series B",
  49: null, // Acquired
  50: null, // IPO
  52: null, // Prior
};

interface KPCompany {
  id: number;
  slug: string;
  title: { rendered: string };
  acf: {
    website_url?: string;
    subhead?: string;
    modal_description?: string;
    sector?: number[];
    stages?: Array<{ stage: number }>;
    timing?: string;
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

const kpAdapter: IngestorAdapter = {
  name: "KP",
  source: "kleinerperkins",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const perPage = 100;
    let page = 1;
    let totalPages = 1;
    const companies: KPCompany[] = [];

    while (page <= totalPages) {
      try {
        const { data, headers } = await axios.get(`${WP_BASE}/company`, {
          params: { per_page: perPage, page, _fields: "id,slug,title,acf" },
          timeout: 15_000,
        });
        if (page === 1) {
          totalPages = parseInt(headers["x-wp-totalpages"] ?? "1", 10);
          console.log(`[KP] ${headers["x-wp-total"]} total companies across ${totalPages} pages`);
        }
        companies.push(...(data as KPCompany[]));
      } catch (err: any) {
        console.error(`[KP] Request failed (page ${page}): ${err.message}`);
        break;
      }
      page++;
      await new Promise((r) => setTimeout(r, 300));
    }

    const out: CompanyRecord[] = [];
    for (const c of companies) {
      if (c.acf.timing !== "Current") continue;
      const website = c.acf.website_url;
      if (!website) continue;

      const sectorNames = (c.acf.sector ?? [])
        .map((id) => SECTOR_MAP[id])
        .filter(Boolean) as string[];

      let stage: string | null = null;
      for (const s of c.acf.stages ?? []) {
        const mapped = STAGE_MAP[s.stage];
        if (mapped !== undefined) {
          stage = mapped;
          break;
        }
      }
      // Skip exited companies (stage resolves to null from STAGE_MAP)
      if (c.acf.stages?.length && stage === null) continue;

      const rawDesc = c.acf.modal_description ?? "";
      out.push({
        name: stripHtml(c.title.rendered),
        website,
        description: rawDesc ? stripHtml(rawDesc).slice(0, 500) : null,
        oneLiner: c.acf.subhead ?? null,
        stage,
        industry: sectorNames[0] ?? null,
        sourceId: c.slug,
        topics: sectorNames,
        investors: ["kleinerperkins"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    return out;
  },
};

export async function ingestKleinerPerkins(): Promise<void> {
  await runIngestor(kpAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestKleinerPerkins().finally(() => prisma.$disconnect()).catch(console.error);
}
