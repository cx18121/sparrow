import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// Greylock Partners — 156 companies via var data_portfolio_XXXX inline JSON.
// Website URL lives inside acf.social_networks_portfolio_string HTML.

const BASE_URL = "https://greylock.com/portfolio";
const SKIP_LINK_DOMAINS = new Set([
  "twitter.com", "x.com", "linkedin.com", "facebook.com",
  "instagram.com", "youtube.com", "crunchbase.com",
]);

interface GreylockCompany {
  title?: string;
  portfolio_status?: string;
  portfolio_domain?: { name?: string };
  acf?: {
    subtitle_portfolio?: string;
    short_description?: string;
    social_networks_portfolio_string?: string;
    hq_portfolio?: string;
  };
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}

function extractWebsite(html: string): string | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  let found: string | null = null;
  $("a[href]").each((_, el) => {
    if (found) return;
    const href = $(el).attr("href") ?? "";
    if (!href.startsWith("http")) return;
    const domain = extractDomain(href);
    if (!domain || SKIP_LINK_DOMAINS.has(domain) || isFreeHostingDomain(domain)) return;
    found = href;
  });
  return found;
}

export async function ingestGreylock(): Promise<void> {
  let html: string;
  try {
    const { data } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ColdFlowBot/1.0)" },
      timeout: 20_000,
    });
    html = data as string;
  } catch (err: any) {
    console.error(`[Greylock] Failed to fetch page: ${err.message}`);
    return;
  }

  const match = html.match(/var data_portfolio_\w+\s*=\s*(\[[\s\S]*?\]);\s*\n/);
  if (!match) {
    console.error("[Greylock] Could not find data_portfolio variable");
    return;
  }

  let companies: GreylockCompany[];
  try {
    companies = JSON.parse(match[1]);
  } catch {
    console.error("[Greylock] Failed to parse portfolio JSON");
    return;
  }
  console.log(`[Greylock] ${companies.length} portfolio companies`);

  let ingested = 0, skipped = 0;

  for (const c of companies) {
    const status = typeof c.portfolio_status === "string" ? c.portfolio_status.toLowerCase() : "";
    if (["exited", "acquired", "ipo"].includes(status)) { skipped++; continue; }

    const website = extractWebsite(c.acf?.social_networks_portfolio_string ?? "");
    if (!website) { skipped++; continue; }

    const domain = extractDomain(website);
    if (!domain || isFreeHostingDomain(domain)) { skipped++; continue; }

    const industry = c.portfolio_domain?.name ?? null;
    const tags = buildTags({ topics: industry ? [industry] : undefined, industry: industry ?? undefined, investors: ["greylock"], signals: ["vc-backed"] });
    const qualityScore = computeQualityScore({ isVerified: true, industry });

    try {
      await upsertCompany({
        domain, name: c.title ?? domain,
        description: c.acf?.short_description ?? null,
        oneLiner: c.acf?.subtitle_portfolio ?? null,
        website, industry, location: c.acf?.hq_portfolio ?? null,
        source: "greylock", sourceId: domain,
        tags, isVerified: true, qualityScore,
      });
      ingested++;
    } catch (err) {
      console.error(`[Greylock] Failed "${c.title}": ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[Greylock] Ingested ${ingested}, skipped ${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestGreylock().finally(() => prisma.$disconnect()).catch(console.error);
}
