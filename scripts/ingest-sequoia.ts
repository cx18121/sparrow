import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// Sequoia Capital — 403 companies.
// Step 1: WP REST API for slugs (5 pages, ACF empty so no data here).
// Step 2: Scrape each company page for website, description, sectors, exit status.
// Skips IPO'd and acquired companies.

const WP_BASE = "https://sequoiacap.com/wp-json/wp/v2";
const COMPANY_BASE = "https://sequoiacap.com/companies";
const REQUEST_DELAY_MS = 350;

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}

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
      slugs.push(...(data as Array<{ slug: string }>).map(c => c.slug));
    } catch (err: any) {
      console.error(`[Sequoia] Failed to fetch slugs (page ${page}): ${err.message}`);
      break;
    }
    page++;
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
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

    // Name: alt attribute of the logo image inside h1
    const name = root.find("h1 img[alt]").first().attr("alt")?.trim() ?? null;

    // Website: href on the anchor wrapping the logo in h1
    // Fall back to the "Visit Website" button
    let website = root.find("h1 a[href]").first().attr("href") ?? null;
    if (!website || website.includes("sequoiacap.com")) {
      website = root.find("a.button[target='_blank']").first().attr("href") ?? null;
    }
    if (website?.includes("sequoiacap.com")) website = null;

    // Description: first paragraph in the wysiwyg content block
    const description = root.find("div.wysiwyg p").first().text().trim() || null;

    // Sectors: pill tags
    const sectors: string[] = [];
    root.find("a.pill.pill--facet").each((_, el) => {
      const text = $(el).text().trim();
      if (text) sectors.push(text);
    });

    // Exit status: look for "IPO" or "Acquired" in milestone list items
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

export async function ingestSequoia(): Promise<void> {
  const slugs = await fetchSlugs();
  if (!slugs.length) {
    console.error("[Sequoia] No slugs found");
    return;
  }

  console.log(`[Sequoia] Scraping ${slugs.length} company pages...`);

  let ingested = 0, skipped = 0, failed = 0;

  for (const slug of slugs) {
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));

    const scraped = await scrapePage(slug);
    if (!scraped) { failed++; continue; }
    if (scraped.exited) { skipped++; continue; }
    if (!scraped.website) { skipped++; continue; }

    const domain = extractDomain(scraped.website);
    if (!domain || isFreeHostingDomain(domain)) { skipped++; continue; }

    const industry = scraped.sectors[0] ?? null;
    const tags = buildTags({
      topics: scraped.sectors,
      signals: ["vc-backed"],
    });
    const qualityScore = computeQualityScore({ isVerified: true, industry });

    try {
      await upsertCompany({
        domain,
        name: scraped.name ?? domain,
        description: scraped.description,
        website: scraped.website,
        industry,
        source: "sequoia",
        sourceId: slug,
        tags,
        isVerified: true,
        qualityScore,
      });
      ingested++;
    } catch (err) {
      console.error(`[Sequoia] Failed "${scraped.name}": ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`[Sequoia] Ingested ${ingested}, skipped ${skipped}, failed ${failed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestSequoia().finally(() => prisma.$disconnect()).catch(console.error);
}
