import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Sequoia Capital — slugs from WP REST API, then scrape each company page for
// website/description/sectors/exit status. Skips IPO'd and acquired companies.

const WP_BASE = "https://sequoiacap.com/wp-json/wp/v2";
const COMPANY_BASE = "https://sequoiacap.com/companies";
const REQUEST_DELAY_MS = 350;

async function fetchSlugs(): Promise<string[]> {
  const slugs: string[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    try {
      const { data, headers } = await axios.get(`${WP_BASE}/company`, {
        params: { per_page: 100, page, _fields: "slug" },
        timeout: 15_000,
      });
      if (page === 1) {
        totalPages = parseInt(headers["x-wp-totalpages"] ?? "1", 10);
        console.log(`[Sequoia] ${headers["x-wp-total"]} companies across ${totalPages} pages`);
      }
      slugs.push(...(data as Array<{ slug: string }>).map((c) => c.slug));
    } catch (err: any) {
      console.error(`[Sequoia] Failed to fetch slugs (page ${page}): ${err.message}`);
      break;
    }
    page++;
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }
  return slugs;
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
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ColdFlowBot/1.0)" },
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
    const slugs = await fetchSlugs();
    if (!slugs.length) {
      console.error("[Sequoia] No slugs found");
      return [];
    }

    console.log(`[Sequoia] Scraping ${slugs.length} company pages...`);
    const out: CompanyRecord[] = [];

    for (const slug of slugs) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));

      const scraped = await scrapePage(slug);
      if (!scraped) continue;
      if (scraped.exited) continue;
      if (!scraped.website || !scraped.name) continue;

      const industry = scraped.sectors[0] ?? null;
      out.push({
        name: scraped.name,
        website: scraped.website,
        description: scraped.description,
        industry,
        sourceId: slug,
        topics: scraped.sectors,
        signals: ["vc-backed"],
        isVerified: true,
      });
    }

    return out;
  },
};

export async function ingestSequoia(): Promise<void> {
  await runIngestor(sequoiaAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestSequoia().finally(() => prisma.$disconnect()).catch(console.error);
}
