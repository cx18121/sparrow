import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Lerer Hippeau portfolio at https://www.lererhippeau.com/portfolio.
// NYC-based early-stage VC. Webflow site, all portfolio companies inline as
// cards with a hover-state revealing details + website link.
//
// Per-card markup:
//   <div class="portfolio-card-hover-content">
//     <img class="hover-logo" src="..." alt=""/>
//     <p class="portfolio-details text-ellipsis">description…</p>
//     <div class="portfolio-card-bottom-holder">
//       <div class="year-holder">… SINCE 2012 …</div>
//       <a href="<website>" target="_blank" class="link-holder">
//         <div class="website-url">Visit</div>
//         <div class="website-url">CompanyName</div>
//         <div class="website-url">→</div>
//       </a>
//     </div>
//   </div>
//   <div fs-cmsfilter-field="Active" class="exit-tag">
//     <div class="exited-text">Exited</div>
//   </div>
//
// Name extraction: pick the middle `<div class="website-url">` (the first
// is "Visit" and the third is "→"). Status from .exit-tag — when its
// .exited-text reads "Exited", filter out.
//
// Pre-rendered with hover-content blocks visible in the static HTML.

const PORTFOLIO_URL = "https://www.lererhippeau.com/portfolio";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOSTS = [
  /(?:^|\.)lererhippeau\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
];

function isCompanyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !NON_COMPANY_HOSTS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

export const lererHippeauAdapter: IngestorAdapter = {
  name: "LererHippeau",
  source: "lerer-hippeau",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[LererHippeau] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(html);
    const out: CompanyRecord[] = [];
    const seen = new Set<string>();

    let exits = 0;
    let noName = 0;
    let noWebsite = 0;
    let dupe = 0;

    // The portfolio card root is .portfolio-card-hover-content's parent —
    // we walk that parent to also see the sibling .exit-tag for status.
    $(".portfolio-card-hover-content").each((_, content) => {
      const $content = $(content);
      // The exit-tag is a sibling of portfolio-card-hover-content within
      // the same card root. Look both inside content and at sibling level.
      const $root = $content.parent();
      const exitedText = $root.find(".exit-tag .exited-text").first().text().trim();
      if (/exited/i.test(exitedText)) {
        exits++;
        return;
      }

      const $link = $content.find("a.link-holder").first();
      const website = $link.attr("href")?.trim();
      if (!website || !/^https?:\/\//i.test(website) || !isCompanyUrl(website)) {
        noWebsite++;
        return;
      }

      // The link-holder has three .website-url children: "Visit",
      // "<CompanyName>", "→". Pick the middle one.
      const websiteUrlDivs = $link.find(".website-url");
      let name: string | null = null;
      if (websiteUrlDivs.length >= 2) {
        name = $(websiteUrlDivs.get(1)).text().trim();
      }
      if (!name) {
        noName++;
        return;
      }

      const description =
        $content.find(".portfolio-details").first().text().trim() || null;

      const key = website.replace(/\/+$/, "").toLowerCase();
      if (seen.has(key)) {
        dupe++;
        return;
      }
      seen.add(key);

      out.push({
        name,
        website,
        oneLiner: description,
        investors: ["lerer-hippeau"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[LererHippeau] fetchAndParse DONE: ${out.length} kept — ` +
        `${exits} exits, ${dupe} dupe, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestLererHippeau(): Promise<void> {
  await runIngestor(lererHippeauAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestLererHippeau().finally(() => prisma.$disconnect()).catch(console.error);
}
