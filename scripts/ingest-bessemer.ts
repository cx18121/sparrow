import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// Bessemer Venture Partners — 510 companies embedded in SSR HTML.
// Each company is a card with data-name, a Visit Website link, description, and sector.

const BASE_URL = "https://www.bvp.com/portfolio";

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}

export async function ingestBessemer(): Promise<void> {
  let html: string;
  try {
    const { data } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ColdFlowBot/1.0)" },
      timeout: 30_000,
    });
    html = data as string;
  } catch (err: any) {
    console.error(`[Bessemer] Failed to fetch page: ${err.message}`);
    return;
  }

  const $ = cheerio.load(html);
  const candidates: Array<{ name: string; website: string; description: string | null; sector: string | null }> = [];
  const seenNames = new Set<string>();

  $("[data-name]").each((_, el) => {
    const name = $(el).attr("data-name")?.trim();
    if (!name || seenNames.has(name)) return;
    seenNames.add(name);

    // Website: first external link in the card
    let websiteHref: string | null = null;
    $(el).find("a[href]").each((_, a) => {
      if (websiteHref) return;
      const href = $(a).attr("href") ?? "";
      if (href.startsWith("http") && !href.includes("bvp.com")) websiteHref = href;
    });
    if (!websiteHref) return;

    const description = $(el).find("p").first().text().trim() || null;
    const sector = $(el).find("[class*='roadmap']").first().text().trim() || null;
    candidates.push({ name, website: websiteHref, description, sector });
  });

  console.log(`[Bessemer] Found ${candidates.length} companies`);

  let ingested = 0, skipped = 0;
  const seen = new Set<string>();

  for (const c of candidates) {
    const domain = extractDomain(c.website);
    if (!domain || seen.has(domain) || isFreeHostingDomain(domain)) { skipped++; continue; }
    seen.add(domain);

    const tags = buildTags({ topics: c.sector ? [c.sector] : undefined, industry: c.sector ?? undefined, investors: ["bessemer"], signals: ["vc-backed"] });
    const qualityScore = computeQualityScore({ isVerified: true, industry: c.sector });

    try {
      await upsertCompany({
        domain, name: c.name, description: c.description, website: c.website,
        industry: c.sector, source: "bessemer", sourceId: domain,
        tags, isVerified: true, qualityScore,
      });
      ingested++;
    } catch (err) {
      console.error(`[Bessemer] Failed "${c.name}": ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[Bessemer] Ingested ${ingested}, skipped ${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestBessemer().finally(() => prisma.$disconnect()).catch(console.error);
}
