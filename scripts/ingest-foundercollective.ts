import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Founder Collective portfolio at https://www.foundercollective.com/portfolio.
// WordPress site. Two surfaces, neither complete on its own:
//
//   1. /wp-json/wp/v2/portfolio — 223 entries with name/slug but NO website
//      URL in the payload (`acf: []`). Categories + location are exposed as
//      term IDs but the company website lives only in the rendered modal.
//
//   2. /portfolio — renders 18 portfolio__details modals with the full
//      detail (name, description, founders, location, categories, website).
//      Category filters don't expand this — same 18 "featured" cards show
//      under every filter. The remaining 205 modals lazy-load via JS we
//      can't trace without Playwright.
//
// This adapter scrapes the 18-card static surface. Yield is small but the
// cards are real and current. Future Playwright-based version could click
// "Load more" / category filters to render the full 223 (see
// scripts/_lib/playwright-scrape.ts when added).
//
// Per-modal markup:
//   <div class="portfolio__details">
//     <div class="company-profile"><img alt="..."></div>
//     <div class="company-info">
//       <div class="company-info__items">
//         <h6 class="title">About <Name></h6>
//         <div class="description"><p>...</p></div>
//       </div>
//       <div class="company-info__items">
//         <h6 class="title">Categories</h6>
//         <ul class="categories"><li>AI</li>...</ul>
//       </div>
//       <div class="company-info__items">
//         <h6 class="title">Location</h6>
//         <span class="Location">LA, US</span>
//       </div>
//       <div class="company-info__items">
//         <ul class="social-media">
//           <li><a href="https://shield.ai/" class="icon-link"></a></li>
//           ...
//         </ul>
//       </div>
//     </div>
//   </div>
//
// The website link is the social-media item with class="icon-link" — twitter
// and linkedin links use other class names so we can target just the website.

const PORTFOLIO_URL = "https://www.foundercollective.com/portfolio";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Extract company name from "About <Name>" headings.
function nameFromAbout(text: string): string | null {
  const m = text.match(/^\s*About\s+(.+?)\s*$/i);
  return m ? m[1].trim() : null;
}

export const founderCollectiveAdapter: IngestorAdapter = {
  name: "FounderCollective",
  source: "founder-collective",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[FC] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(html);
    const out: CompanyRecord[] = [];

    let noName = 0;
    let noWebsite = 0;

    $(".portfolio__details").each((_, el) => {
      const $modal = $(el);

      // Name is in the first "About <Name>" h6 title.
      let name: string | null = null;
      $modal.find(".company-info__items h6.title").each((_, h6) => {
        if (name) return;
        const heading = $(h6).text().trim();
        const n = nameFromAbout(heading);
        if (n) name = n;
      });
      if (!name) {
        noName++;
        return;
      }

      // Website is the social-media item with class="icon-link" (twitter and
      // linkedin use icon-twitter / icon-linkedin).
      const website =
        $modal.find(".social-media a.icon-link").first().attr("href")?.trim() ?? null;
      if (!website || !/^https?:\/\//i.test(website)) {
        noWebsite++;
        return;
      }

      // Description from the "About" section.
      const description =
        $modal.find(".company-info__items .description").first().text().trim() || null;

      // Location string (e.g. "LA, US").
      const location =
        $modal.find(".company-info__items .Location").first().text().trim() || null;

      // Categories — Founder Collective uses tags like "AI", "B2B", "Hardware".
      const topics: string[] = [];
      $modal.find(".categories li").each((_, li) => {
        const t = $(li).text().trim().toLowerCase();
        if (t) topics.push(t);
      });

      out.push({
        name,
        website,
        oneLiner: description,
        location,
        topics,
        investors: ["founder-collective"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[FC] fetchAndParse DONE: ${out.length} kept — ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestFounderCollective(): Promise<void> {
  await runIngestor(founderCollectiveAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestFounderCollective().finally(() => prisma.$disconnect()).catch(console.error);
}
