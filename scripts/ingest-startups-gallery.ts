import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// startups.gallery — curated list of notable startups.
// The site is a static HTML page; we scrape company cards from the DOM.
const BASE_URL = "https://startups.gallery";

function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Attempt to resolve a relative URL against the base.
function resolveUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, BASE_URL).href;
  } catch {
    return null;
  }
}

export async function ingestStartupsGallery(): Promise<void> {
  let html: string;

  try {
    const { data } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ColdFlowBot/1.0)" },
      timeout: 20_000,
    });
    html = data as string;
  } catch (err: any) {
    console.error(`[StartupsGallery] Failed to fetch page: ${err.message}`);
    return;
  }

  const $ = cheerio.load(html);
  let ingested = 0;
  const seen = new Set<string>();

  // The page renders company cards — try multiple selector strategies in order.
  // Strategy A: explicit data-* attributes that encode company metadata
  // Strategy B: generic card/tile patterns with a link and name heading
  const candidates: Array<{ name: string; website: string; description?: string }> = [];

  // Strategy A — look for cards with data-website or data-url
  $("[data-website],[data-url]").each((_, el) => {
    const rawUrl = $(el).attr("data-website") ?? $(el).attr("data-url") ?? "";
    const website = resolveUrl(rawUrl) ?? rawUrl;
    const name =
      $(el).find("h2,h3,[class*='name'],[class*='title']").first().text().trim() ||
      $(el).attr("data-name") ||
      "";
    const description = $(el).find("p,[class*='desc']").first().text().trim();
    if (website && name) candidates.push({ name, website, description });
  });

  // Strategy B — anchor tags that look like company homepages (external links)
  if (candidates.length === 0) {
    $("a[href^='http']").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      if (!href || href.includes("startups.gallery")) return;
      const name =
        $(el).find("h2,h3,[class*='name']").first().text().trim() ||
        $(el).text().trim();
      const description = $(el).closest("[class*='card'],[class*='item']")
        .find("p").first().text().trim();
      if (name && name.length > 1 && name.length < 80) {
        candidates.push({ name, website: href, description });
      }
    });
  }

  console.log(`[StartupsGallery] Found ${candidates.length} candidate companies`);

  let skippedFreeHosting = 0;

  for (const c of candidates) {
    const domain = extractDomain(c.website);
    if (!domain || seen.has(domain) || domain.endsWith("startups.gallery")) continue;
    seen.add(domain);
    if (isFreeHostingDomain(domain)) {
      skippedFreeHosting++;
      continue;
    }

    const tags = buildTags({ signals: ["curated"] });
    const qualityScore = computeQualityScore({});

    try {
      await upsertCompany({
        domain,
        name: c.name,
        oneLiner: c.description || null,
        website: c.website,
        source: "startups_gallery",
        sourceId: domain,
        tags,
        isVerified: false,
        qualityScore,
      });
      ingested++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[StartupsGallery] Failed to upsert ${c.name}: ${msg}`);
    }
  }

  console.log(
    `[StartupsGallery] Ingested ${ingested} — skipped ${skippedFreeHosting} free-hosting domains`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestStartupsGallery().finally(() => prisma.$disconnect()).catch(console.error);
}
