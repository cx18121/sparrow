import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Floodgate portfolio at https://www.floodgate.com/companies. Early-stage
// SF VC. Webflow site, all portfolio companies inline as modal cards.
//
// Per-card markup:
//   <div class="company__hover-state">
//     <div class="companies__name">CompanyName</div>
//     <div class="companies__industry-text">Industry</div>
//   </div>
//   <div class="company-modal">
//     <div class="modal__content-card">
//       <div class="modal__industry-text">Industry</div>
//       <div class="modal__companies__name">CompanyName</div>
//       <a href="<website>" target="_blank" class="modal__link">…</a>
//     </div>
//   </div>
//
// Each company has both hover-state (the visible card) AND a modal block.
// We extract from .modal__content-card since that has the external link.

const PORTFOLIO_URL = "https://www.floodgate.com/companies";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOSTS = [
  /(?:^|\.)floodgate\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
];

function isCompanyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !NON_COMPANY_HOSTS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

export const floodgateAdapter: IngestorAdapter = {
  name: "Floodgate",
  source: "floodgate",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Floodgate] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(html);
    const out: CompanyRecord[] = [];
    const seen = new Set<string>();

    let noName = 0;
    let noWebsite = 0;
    let dupe = 0;

    $(".modal__content-card").each((_, card) => {
      const $card = $(card);

      const name = $card.find(".modal__companies__name").first().text().trim();
      if (!name) {
        noName++;
        return;
      }

      // The modal__link anchor carries the external company URL.
      const website = $card.find("a.modal__link").first().attr("href")?.trim();
      if (!website || !/^https?:\/\//i.test(website) || !isCompanyUrl(website)) {
        noWebsite++;
        return;
      }

      const industry = $card.find(".modal__industry-text").first().text().trim() || null;

      const key = website.replace(/\/+$/, "").toLowerCase();
      if (seen.has(key)) {
        dupe++;
        return;
      }
      seen.add(key);

      out.push({
        name,
        website,
        industry,
        investors: ["floodgate"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[Floodgate] fetchAndParse DONE: ${out.length} kept — ` +
        `${dupe} dupe, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestFloodgate(): Promise<void> {
  await runIngestor(floodgateAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestFloodgate().finally(() => prisma.$disconnect()).catch(console.error);
}
