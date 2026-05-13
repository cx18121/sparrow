import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Sequoia Capital — slugs from WP REST API, then scrape each company page for
// website/description/sectors/exit status. Skips IPO'd and acquired companies.
//
// Stage extraction: Sequoia's per-company HTML pages do NOT publish stage
// data (only Founded year + Partnered year). The full /companies/ listing
// table DOES publish a "First Partnered" column with "Stage (Year)" entries,
// but only for ~52 of 218 companies — the rest of the table is hydrated
// client-side via AJAX that we don't trigger from a clean axios fetch.
// We do a one-time list-page fetch up-front to build a slug → stage map,
// then the existing per-company loop picks up stage when its slug is in
// the map. Only unambiguous labels are mapped (Pre-Seed/Seed → Seed,
// Growth → Series C+); "Early" is intentionally dropped — Sequoia's
// Early-Stage fund covers both Seed and Series A and the column doesn't
// disambiguate, so any single mapping would be wrong roughly half the time.

const LIST_URL = "https://www.sequoiacap.com/companies/";
const WP_BASE = "https://sequoiacap.com/wp-json/wp/v2";
const COMPANY_BASE = "https://sequoiacap.com/companies";
const REQUEST_DELAY_MS = 350;

// Map a Sequoia "First Partnered" stage label to a canonical CANONICAL_STAGES
// value, or null if the label is too ambiguous to assign a single stage.
// Exported for unit tests.
export function normalizeSequoiaStage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^Pre-?Seed\/Seed$/i.test(t)) return "Seed";
  if (/^Pre-?Seed$/i.test(t)) return "Pre-Seed";
  if (/^Seed$/i.test(t)) return "Seed";
  if (/^Growth$/i.test(t)) return "Series C+";
  // "Early" intentionally returns null — see header comment.
  return null;
}

// Build post_id → stage map from the /companies/ listing page. Each
// company row's `<tr data-target="#company_listing-<post_id>">` carries
// the WordPress post id; td[4] is "First Partnered" with "Stage (YYYY)"
// format. Exported for unit tests. Returns numeric ids (matches the WP
// API's company.id field — see fetchSlugs above for the join shape).
export async function fetchSequoiaListStageMap(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const { data: html } = await axios.get<string>(LIST_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 30_000,
    });
    const $ = cheerio.load(html as string);
    $("tr[data-target]").each((_, row) => {
      const $row = $(row);
      const tds = $row.find("td");
      if (tds.length < 5) return;
      const target = $row.attr("data-target") ?? "";
      const idMatch = target.match(/^#company_listing-(\d+)$/);
      if (!idMatch) return;
      const postId = parseInt(idMatch[1], 10);
      const cellText = $(tds[4]).text().trim();
      const labelMatch = cellText.match(/^(.+?)\s*\(\d{4}\)\s*$/);
      const label = labelMatch ? labelMatch[1].trim() : cellText;
      const canonical = normalizeSequoiaStage(label);
      if (canonical) map.set(postId, canonical);
    });
  } catch (err: any) {
    console.error(`[Sequoia] Stage list-page fetch failed: ${err.message}`);
  }
  return map;
}

interface SequoiaSlugRecord {
  slug: string;
  id: number;
}

async function fetchSlugs(): Promise<SequoiaSlugRecord[]> {
  const out: SequoiaSlugRecord[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    try {
      const { data, headers } = await axios.get(`${WP_BASE}/company`, {
        params: { per_page: 100, page, _fields: "id,slug" },
        timeout: 15_000,
      });
      if (page === 1) {
        totalPages = parseInt(headers["x-wp-totalpages"] ?? "1", 10);
        console.log(`[Sequoia] ${headers["x-wp-total"]} companies across ${totalPages} pages`);
      }
      out.push(...(data as Array<{ id: number; slug: string }>));
    } catch (err: any) {
      console.error(`[Sequoia] Failed to fetch slugs (page ${page}): ${err.message}`);
      break;
    }
    page++;
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }
  return out;
}

interface ScrapedCompany {
  name: string | null;
  website: string | null;
  description: string | null;
  sectors: string[];
  exited: boolean;
}

async function scrapePage(slug: string): Promise<ScrapedCompany | null> {
  try {
    const { data: html } = await axios.get(`${COMPANY_BASE}/${slug}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 15_000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(html as string);
    const root = $("section.company");
    if (!root.length) return null;

    const name = root.find("h1 img[alt]").first().attr("alt")?.trim() ?? null;

    let website = root.find("h1 a[href]").first().attr("href") ?? null;
    if (!website || website.includes("sequoiacap.com")) {
      website = root.find("a.button[target='_blank']").first().attr("href") ?? null;
    }
    if (website?.includes("sequoiacap.com")) website = null;

    const description = root.find("div.wysiwyg p").first().text().trim() || null;

    const sectors: string[] = [];
    root.find("a.pill.pill--facet").each((_, el) => {
      const text = $(el).text().trim();
      if (text) sectors.push(text);
    });

    let exited = false;
    root.find("li.clist__item").each((_, el) => {
      const text = $(el).text().toLowerCase();
      if (text.includes("ipo") || text.includes("acquired")) exited = true;
    });

    return { name, website, description, sectors, exited };
  } catch {
    return null;
  }
}

const sequoiaAdapter: IngestorAdapter = {
  name: "Sequoia",
  source: "sequoia",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const records = await fetchSlugs();
    if (!records.length) {
      console.error("[Sequoia] No slugs found");
      return [];
    }

    // One-time list-page fetch up-front. Map covers companies surfaced in
    // the /companies/ table; companies absent from the table (older /
    // historical) get null stage.
    const stageMap = await fetchSequoiaListStageMap();
    console.log(`[Sequoia] Stage map size: ${stageMap.size}`);

    console.log(`[Sequoia] Scraping ${records.length} company pages...`);
    const out: CompanyRecord[] = [];
    let withStage = 0;

    for (const { slug, id } of records) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));

      const scraped = await scrapePage(slug);
      if (!scraped) continue;
      if (scraped.exited) continue;
      if (!scraped.website || !scraped.name) continue;

      const industry = scraped.sectors[0] ?? null;
      const stage = stageMap.get(id) ?? null;
      if (stage) withStage++;
      out.push({
        name: scraped.name,
        website: scraped.website,
        description: scraped.description,
        stage,
        industry,
        sourceId: slug,
        topics: scraped.sectors,
        investors: ["sequoia"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }

    console.log(`[Sequoia] fetchAndParse DONE: ${out.length} kept, ${withStage} with stage`);
    return out;
  },
};

export async function ingestSequoia(): Promise<void> {
  await runIngestor(sequoiaAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestSequoia().finally(() => prisma.$disconnect()).catch(console.error);
}
