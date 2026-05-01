import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// Kleiner Perkins portfolio — 403 companies via their public WordPress REST API.
// ACF custom fields include website, description, sector (taxonomy IDs), and stage.
// Filter: acf.timing === "Current" (active investments only).

const WP_BASE = "https://www.kleinerperkins.com/wp-json/wp/v2";

// Sector taxonomy IDs from /wp-json/wp/v2/sector
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

// Stage taxonomy IDs from /wp-json/wp/v2/stage
const STAGE_MAP: Record<number, string | null> = {
  34: "Seed",      // "Early"
  35: "Series B",  // "Growth"
  49: null,        // Acquired — skip
  50: null,        // IPO — skip
  52: null,        // Prior — skip
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
    since_text?: string;
  };
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

export async function ingestKleinerPerkins(): Promise<void> {
  const perPage = 100;
  let page = 1;
  let totalPages = 1;
  const companies: KPCompany[] = [];

  // Paginate through all 403 companies (5 pages)
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
    await new Promise(r => setTimeout(r, 300));
  }

  let ingested = 0;
  let skipped = 0;

  for (const c of companies) {
    // Only active portfolio companies
    if (c.acf.timing !== "Current") { skipped++; continue; }

    const website = c.acf.website_url;
    if (!website) { skipped++; continue; }

    const domain = extractDomain(website);
    if (!domain || isFreeHostingDomain(domain)) { skipped++; continue; }

    // Resolve sector IDs → names
    const sectorNames = (c.acf.sector ?? []).map(id => SECTOR_MAP[id]).filter(Boolean) as string[];

    // Resolve stage: use first non-null stage
    let stage: string | null = null;
    for (const s of c.acf.stages ?? []) {
      const mapped = STAGE_MAP[s.stage];
      if (mapped !== undefined) { stage = mapped; break; }
    }
    // Skip exited companies (stage resolves to null from STAGE_MAP)
    if (c.acf.stages?.length && stage === null) { skipped++; continue; }

    const rawDesc = c.acf.modal_description ?? "";
    const description = rawDesc ? stripHtml(rawDesc).slice(0, 500) : null;
    const oneLiner = c.acf.subhead ?? null;

    const tags = buildTags({
      topics: sectorNames,
      industry: sectorNames[0] ?? undefined,
      stage,
      investors: ["kleinerperkins"],
      signals: ["vc-backed"],
    });
    const qualityScore = computeQualityScore({
      isVerified: true,
      stage,
      industry: sectorNames[0] ?? null,
    });

    try {
      await upsertCompany({
        domain,
        name: stripHtml(c.title.rendered),
        description,
        oneLiner,
        website,
        stage,
        industry: sectorNames[0] ?? null,
        source: "kleinerperkins",
        sourceId: c.slug,
        tags,
        isVerified: true,
        qualityScore,
      });
      ingested++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[KP] Failed "${c.title.rendered}": ${msg}`);
    }
  }

  console.log(`[KP] Ingested ${ingested}, skipped ${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestKleinerPerkins().finally(() => prisma.$disconnect()).catch(console.error);
}
