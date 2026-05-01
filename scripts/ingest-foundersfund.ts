import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// Founders Fund — 62 companies via window.__data WordPress inline JSON.
// Website URLs are in the profiles HTML field with malformed triple-slash URLs.

const BASE_URL = "https://foundersfund.com/portfolio";
const SKIP_LINK_DOMAINS = new Set([
  "twitter.com", "x.com", "linkedin.com", "facebook.com",
  "instagram.com", "foundersfund.com",
]);

interface FFCompany {
  title?: { rendered?: string };
  content?: { rendered?: string };
  class_list?: string[];
  profiles?: string;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}

function fixUrl(url: string): string {
  return url.replace(/^https?:\/\/\/+/, "https://");
}

function extractWebsite(html: string): string | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  let found: string | null = null;
  $("a[href]").each((_, el) => {
    if (found) return;
    const href = fixUrl($(el).attr("href") ?? "");
    if (!href.startsWith("http")) return;
    const domain = extractDomain(href);
    if (!domain || SKIP_LINK_DOMAINS.has(domain) || isFreeHostingDomain(domain)) return;
    found = href;
  });
  return found;
}

function extractIndustry(classList: string[] | undefined): string | null {
  for (const cls of classList ?? []) {
    const m = cls.match(/^company_industry-(.+)$/);
    if (m) return m[1].replace(/-/g, " ");
  }
  return null;
}

export async function ingestFoundersFund(): Promise<void> {
  let html: string;
  try {
    const { data } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ColdFlowBot/1.0)" },
      timeout: 20_000,
    });
    html = data as string;
  } catch (err: any) {
    console.error(`[FoundersFund] Failed to fetch page: ${err.message}`);
    return;
  }

  const match = html.match(/window\.__data\s*=\s*(\{[\s\S]*?\});\s*\n/);
  if (!match) {
    console.error("[FoundersFund] Could not find window.__data");
    return;
  }

  let raw: { companies?: FFCompany[] };
  try {
    raw = JSON.parse(match[1]);
  } catch {
    console.error("[FoundersFund] Failed to parse window.__data JSON");
    return;
  }

  const companies = raw.companies ?? [];
  console.log(`[FoundersFund] ${companies.length} portfolio companies`);

  let ingested = 0, skipped = 0;

  for (const c of companies) {
    const name = c.title?.rendered ? cheerio.load(c.title.rendered).text().trim() : null;
    if (!name) { skipped++; continue; }

    const website = extractWebsite(c.profiles ?? "");
    if (!website) { skipped++; continue; }

    const domain = extractDomain(website);
    if (!domain || isFreeHostingDomain(domain)) { skipped++; continue; }

    const industry = extractIndustry(c.class_list);
    const description = c.content?.rendered
      ? cheerio.load(c.content.rendered).text().trim().slice(0, 500) || null
      : null;

    const tags = buildTags({ topics: industry ? [industry] : undefined, industry: industry ?? undefined, investors: ["foundersfund"], signals: ["vc-backed"] });
    const qualityScore = computeQualityScore({ isVerified: true, industry });

    try {
      await upsertCompany({
        domain, name, description, website, industry,
        source: "foundersfund", sourceId: domain,
        tags, isVerified: true, qualityScore,
      });
      ingested++;
    } catch (err) {
      console.error(`[FoundersFund] Failed "${name}": ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[FoundersFund] Ingested ${ingested}, skipped ${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestFoundersFund().finally(() => prisma.$disconnect()).catch(console.error);
}
