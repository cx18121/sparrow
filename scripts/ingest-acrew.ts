import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Acrew Capital portfolio at https://www.acrewcapital.com/companies.
//
// Single-pass: Webflow site that renders every company card inline with
// the external URL on the card anchor. ~98 companies in static HTML.

const LISTING_URL = "https://www.acrewcapital.com/companies";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)acrewcapital\.com$/i,
  /(?:^|\.)googletagmanager\.com$/i,
  /(?:^|\.)googleapis\.com$/i,
  /(?:^|\.)gstatic\.com$/i,
  /(?:^|\.)cdn\.prod\.website-files\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)tiktok\.com$/i,
  /(?:^|\.)cookielaw\.org$/i,
  /(?:^|\.)onetrust\.com$/i,
  /(?:^|\.)schema\.org$/i,
  /(?:^|\.)w3\.org$/i,
];

function isCompanyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !NON_COMPANY_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

export const acrewAdapter: IngestorAdapter = {
  name: "Acrew",
  source: "acrew",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Acrew] GET ${LISTING_URL}`);
    const { data: html } = await axios.get<string>(LISTING_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    interface Row { website: string; name: string; stage: string | null; thesis: string | null; horizontal: string | null }
    const byDomain = new Map<string, Row>();

    // Each portfolio entry is `<div class="w-dyn-item">` wrapping a
    // `<a class="w-inline-block" href="<external>">` with the company name
    // in the inner <img alt> and hidden fs-cmsfilter-field metadata.
    $(".collection-companies_list .w-dyn-item").each((_, el) => {
      const $card = $(el);
      const $a = $card.find("a.w-inline-block").first();
      const href = ($a.attr("href") ?? "").trim();
      if (!href || !isCompanyUrl(href)) return;

      let domain: string;
      try {
        domain = new URL(href).hostname.replace(/^www\./, "");
      } catch {
        return;
      }
      if (byDomain.has(domain)) return;

      const alt = $a.find("img").attr("alt")?.trim() ?? "";
      // Strip parenthetical exit tags like " (a SLACK company)" / "(Acquired)".
      const name = alt.replace(/\s*\(.+?\)\s*$/, "").trim()
        || domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

      const labelOf = (field: string): string | null => {
        const v = $card.find(`[fs-cmsfilter-field="${field}"]`).first().text().trim();
        return v || null;
      };
      const stage = labelOf("stages");        // "Early" / "Growth" / "Pre-Seed"
      const thesis = labelOf("thesis");        // "Data & Security" / "Fintech"
      const horizontal = labelOf("horizontals"); // "AI & ML" / etc

      byDomain.set(domain, { website: href, name, stage, thesis, horizontal });
    });

    console.log(`[Acrew] unique company links: ${byDomain.size}`);

    const out: CompanyRecord[] = [];
    for (const [, r] of byDomain) {
      out.push({
        name: r.name,
        website: r.website,
        // Acrew's stage vocab is coarse (Pre-Seed / Early / Growth). Pass
        // through; downstream `expandStageFilter` handles normalization.
        stage: r.stage,
        industry: r.thesis,
        topics: r.horizontal ? [r.horizontal] : undefined,
        investors: ["acrew"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    return out;
  },
};

export async function ingestAcrew(): Promise<void> {
  await runIngestor(acrewAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestAcrew().finally(() => prisma.$disconnect()).catch(console.error);
}
