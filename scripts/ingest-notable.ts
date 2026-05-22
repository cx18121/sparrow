import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Notable Capital portfolio at https://www.notablecap.com/companies.
//
// Single-pass: Webflow CMS list with all ~117 companies in static HTML.
// Each card has:
//   - <a href="<external>" class="c-logo_list_wrap"> — company URL
//   - fs-cmsfilter-field="company" — company name
//   - fs-cmsfilter-field="description" — one-liner
//   - fs-cmsfilter-field="location1" — geo
//   - <div class="c-tag cc-stroke"> with text like "NASDAQ:AFRM" /
//     "ACQ. BY IBM" — ticker for IPOs, acquirer for exits, absent for
//     current investments.
//
// We filter cards whose tag includes "ACQ. BY" (acquired/exited).

const LISTING_URL = "https://www.notablecap.com/companies";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)notablecap\.com$/i,
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

export const notableAdapter: IngestorAdapter = {
  name: "Notable",
  source: "notable",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Notable] GET ${LISTING_URL}`);
    const { data: html } = await axios.get<string>(LISTING_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    interface Row { website: string; name: string; oneLiner: string | null; location: string | null }
    const byDomain = new Map<string, Row>();
    let exits = 0;

    $(".w-dyn-item").each((_, el) => {
      const $card = $(el);
      // Cards have a logo link with the external URL.
      const $a = $card.find("a.c-logo_list_wrap").first();
      const href = ($a.attr("href") ?? "").trim();
      if (!href || !isCompanyUrl(href)) return;

      let domain: string;
      try {
        domain = new URL(href).hostname.replace(/^www\./, "");
      } catch {
        return;
      }
      if (byDomain.has(domain)) return;

      const name = $card.find('[fs-cmsfilter-field="company"]').first().text().trim();
      if (!name) return;

      // Acquisition tags appear as "ACQ. BY <ACQUIRER>" inside .c-tag.
      const tagText = $card.find(".c-tag").text();
      if (/acq\.\s*by/i.test(tagText)) {
        exits++;
        return;
      }

      const oneLiner = $card.find('[fs-cmsfilter-field="description"]').first().text().trim() || null;
      const location = $card.find('[fs-cmsfilter-field="location1"]').first().text().trim() || null;

      byDomain.set(domain, { website: href, name, oneLiner, location });
    });

    console.log(`[Notable] kept: ${byDomain.size}, exits filtered: ${exits}`);

    const out: CompanyRecord[] = [];
    for (const [, r] of byDomain) {
      out.push({
        name: r.name,
        website: r.website,
        oneLiner: r.oneLiner,
        location: r.location,
        investors: ["notable"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    return out;
  },
};

export async function ingestNotable(): Promise<void> {
  await runIngestor(notableAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestNotable().finally(() => prisma.$disconnect()).catch(console.error);
}
