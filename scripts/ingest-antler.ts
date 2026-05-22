import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Antler portfolio at https://www.antler.co/portfolio. Global early-stage
// accelerator (6 continents, 30+ industries). Webflow site.
//
// Per-card markup:
//   <div class="portco_card">
//     <div class="portco_card_thumbnail"><img alt="<Name>"/></div>
//     <div class="portco_card_content">
//       <div class="portco_card_heading_wrap">
//         <p fs-cmsfilter-field="name">Agri Sparta</p>
//         <p fs-cmsfilter-field="description">Industrializing rice farming</p>
//       </div>
//       <div class="portco_card_tags">
//         <div fs-cmsfilter-field="Indonesia"><div>Indonesia</div></div>
//         <div fs-cmsfilter-field="sector"><div>Industrials</div></div>
//         <div fs-cmsfilter-field="year"><div>2023</div></div>
//       </div>
//     </div>
//     <div class="clickable_wrap">
//       <a target="_blank" href="<website>" class="clickable_link">…</a>
//     </div>
//   </div>
//
// Static HTML exposes ~52 cards (one render batch). Future iteration with
// Playwright + scrollToBottom could surface the full multi-thousand portfolio
// across all continents/sectors; the 52-card static slice is what this
// adapter ships. Most are 2023-2025 vintage early-stage companies, which is
// high target relevance for Sparrow's cold-email audience.

const PORTFOLIO_URL = "https://www.antler.co/portfolio";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOSTS = [
  /(?:^|\.)antler\.co$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
];

function isCompanyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !NON_COMPANY_HOSTS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

export const antlerAdapter: IngestorAdapter = {
  name: "Antler",
  source: "antler",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Antler] GET ${PORTFOLIO_URL}`);
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

    $(".portco_card").each((_, card) => {
      const $card = $(card);

      const name = $card
        .find('p[fs-cmsfilter-field="name"]')
        .first()
        .text()
        .trim();
      if (!name) {
        noName++;
        return;
      }

      const website = $card.find("a.clickable_link").first().attr("href")?.trim();
      if (!website || !/^https?:\/\//i.test(website) || !isCompanyUrl(website)) {
        noWebsite++;
        return;
      }

      const oneLiner = $card
        .find('p[fs-cmsfilter-field="description"]')
        .first()
        .text()
        .trim() || null;

      // Tags: location, sector, year. The Webflow filter library uses
      // fs-cmsfilter-field on each tag's wrapper with the field name as
      // the attribute value; the inner div carries the visible text.
      let location: string | null = null;
      let sector: string | null = null;
      $card.find(".tag_small_wrap").each((i, tag) => {
        const text = $(tag).find(".tag_small_text").first().text().trim();
        if (!text) return;
        // The first tag wrapper carries the location, second is sector,
        // third is year. Year is numeric — easy to discriminate.
        if (/^\d{4}$/.test(text)) return;
        if (i === 0) location = text;
        else if (!sector) sector = text;
      });

      const key = website.replace(/\/+$/, "").toLowerCase();
      if (seen.has(key)) {
        dupe++;
        return;
      }
      seen.add(key);

      out.push({
        name,
        website,
        oneLiner,
        location,
        industry: sector,
        investors: ["antler"],
        signals: ["vc-backed", "accelerator-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[Antler] fetchAndParse DONE: ${out.length} kept — ` +
        `${dupe} dupe, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestAntler(): Promise<void> {
  await runIngestor(antlerAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestAntler().finally(() => prisma.$disconnect()).catch(console.error);
}
