import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Greycroft Ventures portfolio at https://www.greycroft.com/portfolio.
// WordPress site; the /portfolio archive page renders all 236 portfolio
// cards inline as a single static HTML grid — no detail-page hop required.
//
// Per-card markup (filter-top block):
//   <div class="portfolio-card">
//     <button class="portfolio-card__top-con">
//       <div class="portfolio-card__title">AMI Labs</div>
//       <div class="portfolio-card__status Active">Active</div>
//       <div class="portfolio-card__year">2026</div>
//       <div class="portfolio-card__strategy">Software</div>
//     </button>
//     <div class="portfolio-card__accordion">
//       …<a href="https://amilabs.xyz/">…</a>…
//     </div>
//   </div>
//
// Per-card fields exposed and used:
//   - portfolio-card__title       → name
//   - portfolio-card__status      → status: Active | Acquired | IPO
//   - portfolio-card__year        → investment year (informational only,
//                                   not persisted; no stage field on page)
//   - portfolio-card__strategy    → "Software" | "Consumer Brands" |
//                                   "Sustainability" → industry
//   - first external href in card → website (filter out greycroft.com,
//                                   cdn.greycroft.com, jobs.greycroft.com,
//                                   junipersquare.com, social hosts)
//
// Status distribution (probe 2026-05-21): 170 Active, 56 Acquired, 10 IPO.
// Filter all non-Active rows — Greycroft labels exits explicitly so we don't
// need an IVP-style PREEXISTING_PUBLICS skiplist. Of the 170 Active rows,
// ~16 have no external website (placeholder cards / stealth) — those drop
// at the website check.
//
// No stage data anywhere on the surface — every row ingests with stage=null,
// same shape as Khosla / IVP / Insight.

const PORTFOLIO_URL = "https://www.greycroft.com/portfolio/";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Hosts that must NOT be treated as a portfolio company's website.
// Filters Greycroft's own infra + universal social/admin chrome.
const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)greycroft\.com$/i,
  /(?:^|\.)junipersquare\.com$/i,
  /(?:^|\.)unpkg\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)tiktok\.com$/i,
];

function isCompanyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !NON_COMPANY_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

// Greycroft's strategy field is a closed three-value vocabulary. Pass through
// to industry as-is; downstream tag normalization (`buildTags`) routes these
// into vertical:* / industry: tags.
function strategyToIndustry(strategy: string | null): string | null {
  if (!strategy) return null;
  const s = strategy.trim();
  if (!s) return null;
  return s;
}

export const greycroftAdapter: IngestorAdapter = {
  name: "Greycroft",
  source: "greycroft",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Greycroft] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(html);
    const out: CompanyRecord[] = [];

    let nonActive = 0;
    let noName = 0;
    let noWebsite = 0;

    $(".portfolio-card").each((_, el) => {
      const $card = $(el);

      const name = $card.find(".portfolio-card__title").first().text().trim();
      if (!name) {
        noName++;
        return;
      }

      // Status class is "portfolio-card__status Active" / "...Acquired" / "...IPO".
      // Cheerio gives us the class string directly via attr("class").
      const statusClass = $card
        .find(".portfolio-card__status")
        .first()
        .attr("class") ?? "";
      const statusToken = statusClass
        .split(/\s+/)
        .find((t) => t !== "portfolio-card__status" && !t.startsWith("portfolio-card__status--"));
      const status = (statusToken ?? "").trim();

      if (status !== "Active") {
        nonActive++;
        return;
      }

      // First external href inside the card that isn't Greycroft's own
      // infra or a social host. Wrapped in the accordion block.
      let website: string | null = null;
      $card.find("a[href^='http']").each((_, a) => {
        const href = $(a).attr("href")?.trim();
        if (!href || !/^https?:\/\//i.test(href)) return;
        if (!isCompanyUrl(href)) return;
        website = href;
        return false;
      });

      if (!website) {
        noWebsite++;
        return;
      }

      const strategy = $card
        .find(".portfolio-card__strategy")
        .first()
        .text()
        .trim();

      out.push({
        name,
        website,
        industry: strategyToIndustry(strategy),
        investors: ["greycroft"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[Greycroft] fetchAndParse DONE: ${out.length} kept — ` +
        `${nonActive} exits, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestGreycroft(): Promise<void> {
  await runIngestor(greycroftAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestGreycroft().finally(() => prisma.$disconnect()).catch(console.error);
}
