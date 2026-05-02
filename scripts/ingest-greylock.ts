import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Greylock Partners — companies via var data_portfolio_XXXX inline JSON.
// Website URL lives inside acf.social_networks_portfolio_string HTML.

const BASE_URL = "https://greylock.com/portfolio";
const SKIP_LINK_DOMAINS = new Set([
  "twitter.com",
  "x.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "crunchbase.com",
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

function extractWebsite(html: string): string | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  let found: string | null = null;
  $("a[href]").each((_, el) => {
    if (found) return;
    const href = $(el).attr("href") ?? "";
    if (!href.startsWith("http")) return;
    let domain: string;
    try {
      domain = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return;
    }
    if (SKIP_LINK_DOMAINS.has(domain)) return;
    found = href;
  });
  return found;
}

const greylockAdapter: IngestorAdapter = {
  name: "Greylock",
  source: "greylock",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { data: html } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 20_000,
    });

    const match = (html as string).match(/var data_portfolio_\w+\s*=\s*(\[[\s\S]*?\]);\s*\n/);
    if (!match) {
      console.error("[Greylock] Could not find data_portfolio variable");
      return [];
    }

    let companies: GreylockCompany[];
    try {
      companies = JSON.parse(match[1]);
    } catch {
      console.error("[Greylock] Failed to parse portfolio JSON");
      return [];
    }

    const out: CompanyRecord[] = [];
    for (const c of companies) {
      const status =
        typeof c.portfolio_status === "string" ? c.portfolio_status.toLowerCase() : "";
      if (["exited", "acquired", "ipo"].includes(status)) continue;

      const website = extractWebsite(c.acf?.social_networks_portfolio_string ?? "");
      if (!website) continue;

      const industry = c.portfolio_domain?.name ?? null;
      out.push({
        name: c.title ?? "",
        website,
        description: c.acf?.short_description ?? null,
        oneLiner: c.acf?.subtitle_portfolio ?? null,
        industry,
        location: c.acf?.hq_portfolio ?? null,
        topics: industry ? [industry] : undefined,
        investors: ["greylock"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    return out;
  },
};

export async function ingestGreylock(): Promise<void> {
  await runIngestor(greylockAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestGreylock().finally(() => prisma.$disconnect()).catch(console.error);
}
