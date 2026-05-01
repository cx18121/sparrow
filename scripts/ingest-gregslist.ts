import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// gregslist.com — Greg Isenberg's curated list of interesting startups / companies.
// The site is a static HTML page scraped via cheerio.
const BASE_URL = "https://gregslist.com";

function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function ingestGregslist(): Promise<void> {
  let html: string;

  try {
    const { data } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ColdFlowBot/1.0)" },
      timeout: 20_000,
    });
    html = data as string;
  } catch (err: any) {
    console.error(`[Gregslist] Failed to fetch page: ${err.message}`);
    return;
  }

  const $ = cheerio.load(html);
  let ingested = 0;
  const seen = new Set<string>();

  const candidates: Array<{ name: string; website: string; description?: string; industry?: string }> = [];

  const SOCIAL_DOMAINS = ["twitter.com", "linkedin.com", "instagram.com", "facebook.com", "youtube.com", "x.com", "github.com"];
  const isSocialLink = (href: string) => SOCIAL_DOMAINS.some(d => href.includes(d));

  // Strategy A: rows/cards that have both a title and an external link
  $("[class*='row'],[class*='card'],[class*='item'],[class*='company'],[class*='startup']").each((_, el) => {
    const link = $(el).find("a[href^='http']").first();
    const href = link.attr("href") ?? "";
    if (!href || href.includes("gregslist.com") || isSocialLink(href)) return;

    const name =
      $(el).find("h2,h3,h4,[class*='name'],[class*='title']").first().text().trim() ||
      link.text().trim();
    const description = $(el).find("p,[class*='desc'],[class*='tagline']").first().text().trim();
    const industry = $(el).find("[class*='tag'],[class*='category'],[class*='badge']").first().text().trim();

    if (name && name.length > 1 && name.length < 80 && href) {
      candidates.push({ name, website: href, description: description || undefined, industry: industry || undefined });
    }
  });

  // Strategy B: fall back to all external anchor tags with meaningful link text
  if (candidates.length === 0) {
    $("a[href^='http']").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      if (!href || href.includes("gregslist.com") || href.includes("twitter.com") ||
          href.includes("linkedin.com") || href.includes("instagram.com")) return;

      const name = $(el).text().trim();
      if (name && name.length > 1 && name.length < 80) {
        const description = $(el).closest("li,tr,div").find("p,span").not($(el)).first().text().trim();
        candidates.push({ name, website: href, description: description || undefined });
      }
    });
  }

  console.log(`[Gregslist] Found ${candidates.length} candidate companies`);

  let skippedFreeHosting = 0;

  for (const c of candidates) {
    const domain = extractDomain(c.website);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    if (isFreeHostingDomain(domain)) {
      skippedFreeHosting++;
      continue;
    }

    const tags = buildTags({
      industry: c.industry,
      signals: ["curated"],
    });
    const qualityScore = computeQualityScore({
      industry: c.industry,
    });

    try {
      await upsertCompany({
        domain,
        name: c.name,
        oneLiner: c.description || null,
        website: c.website,
        industry: c.industry || null,
        source: "gregslist",
        sourceId: domain,
        tags,
        isVerified: false,
        qualityScore,
      });
      ingested++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Gregslist] Failed to upsert ${c.name}: ${msg}`);
    }
  }

  console.log(
    `[Gregslist] Ingested ${ingested} — skipped ${skippedFreeHosting} free-hosting domains`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestGregslist().finally(() => prisma.$disconnect()).catch(console.error);
}
