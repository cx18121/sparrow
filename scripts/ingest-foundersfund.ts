import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Founders Fund — companies via window.__data WordPress inline JSON.
// Falls back to WP REST API if the inline payload is missing or restructured.

const BASE_URL = "https://foundersfund.com/portfolio";
const WP_API_BASE = "https://foundersfund.com/wp-json/wp/v2";
const WP_POST_TYPES = ["company", "companies", "portfolio_company", "portfolio"];
const SKIP_LINK_DOMAINS = new Set([
  "twitter.com",
  "x.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "foundersfund.com",
]);

interface FFCompany {
  title?: { rendered?: string };
  content?: { rendered?: string };
  class_list?: string[];
  profiles?: string;
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

function extractIndustry(classList: string[] | undefined): string | null {
  for (const cls of classList ?? []) {
    const m = cls.match(/^company_industry-(.+)$/);
    if (m) return m[1].replace(/-/g, " ");
  }
  return null;
}

async function fetchViaWpApi(): Promise<FFCompany[]> {
  for (const postType of WP_POST_TYPES) {
    try {
      const all: FFCompany[] = [];
      let page = 1;
      while (true) {
        const { data, headers } = await axios.get(`${WP_API_BASE}/${postType}`, {
          params: { per_page: 100, page, _fields: "id,title,content,class_list,profiles" },
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
          timeout: 20_000,
        });
        if (!Array.isArray(data) || data.length === 0) break;
        all.push(...data);
        const totalPages = parseInt(headers["x-wp-totalpages"] ?? "1", 10);
        if (page >= totalPages) break;
        page++;
      }
      if (all.length > 0) {
        console.log(`[FoundersFund] WP REST API (${postType}): ${all.length} entries`);
        return all;
      }
    } catch {
      // try next post type
    }
  }
  return [];
}

const foundersFundAdapter: IngestorAdapter = {
  name: "FoundersFund",
  source: "foundersfund",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    let companies: FFCompany[] = [];

    const { data: html } = await axios
      .get(BASE_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
        timeout: 20_000,
      })
      .catch((err: any) => {
        console.error(`[FoundersFund] Failed to fetch page: ${err.message}`);
        return { data: "" };
      });

    const match = (html as string).match(/window\.__data\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (match) {
      try {
        const raw: { companies?: FFCompany[] } = JSON.parse(match[1]);
        companies = raw.companies ?? [];
      } catch {
        console.warn("[FoundersFund] Failed to parse window.__data — falling back to WP REST API");
      }
    }

    if (companies.length === 0) {
      companies = await fetchViaWpApi();
    }

    if (companies.length === 0) {
      console.error("[FoundersFund] Could not retrieve portfolio data");
      return [];
    }

    const out: CompanyRecord[] = [];
    for (const c of companies) {
      const name = c.title?.rendered ? cheerio.load(c.title.rendered).text().trim() : null;
      if (!name) continue;
      const website = extractWebsite(c.profiles ?? "");
      if (!website) continue;
      const industry = extractIndustry(c.class_list);
      const description = c.content?.rendered
        ? cheerio.load(c.content.rendered).text().trim().slice(0, 500) || null
        : null;

      out.push({
        name,
        website,
        description,
        industry,
        topics: industry ? [industry] : undefined,
        investors: ["foundersfund"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }

    return out;
  },
};

export async function ingestFoundersFund(): Promise<void> {
  await runIngestor(foundersFundAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestFoundersFund().finally(() => prisma.$disconnect()).catch(console.error);
}
