import "dotenv/config";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { withBrowser, renderPage } from "./_lib/playwright-scrape.js";

// DCM Ventures (US/Asia) portfolio at https://www.dcm.com/en/portfolio.
// Webflow site with Webflow CMS infinite-scroll. Static HTML exposes 153
// company anchors; full portfolio renders after JS hydration + scroll.
//
// Per-card markup:
//   <div class="portfolio-card w-dyn-item">
//     <a href="<external-website>" target="_blank" class="portfolio-link-wrapper">
//       <div class="portfolio-logo-wrapper">…<img alt="<Name>"/>…</div>
//       <div class="portfolio-card-content">
//         <div class="portfolio-name">CompanyName</div>
//         <div class="portfolio-description">description…</div>
//         <div fs-cmsfilter-field="industry">Sector</div>
//         <div fs-cmsfilter-field="status">Active</div>
//       </div>
//     </a>
//   </div>
//
// Use Playwright + scrollToBottom to fetch the fully-hydrated list (the
// page uses `fs-cmsload-mode="infinite"`). Cheerio then parses the rendered
// DOM the same way as a static Webflow site.

const PORTFOLIO_URL = "https://www.dcm.com/en/portfolio";

const NON_COMPANY_HOSTS = [
  /(?:^|\.)dcm\.com$/i,
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

export const dcmAdapter: IngestorAdapter = {
  name: "DCM",
  source: "dcm-ventures",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[DCM] rendering ${PORTFOLIO_URL} via Playwright`);
    const html = await withBrowser((browser) =>
      renderPage(browser, PORTFOLIO_URL, {
        scrollToBottom: true,
        waitForTimeout: 8000,
      })
    );

    const $ = cheerio.load(html);
    const out: CompanyRecord[] = [];
    const seen = new Set<string>();

    let noName = 0;
    let noWebsite = 0;
    let dupe = 0;

    $(".portfolio-card").each((_, card) => {
      const $card = $(card);

      // DCM doesn't expose an exit/status field on cards — the page mixes
      // active and exited companies. Cross-source dedupe absorbs IPO/
      // acquired overlap with sources that DO mark exits (a16z, IVP).

      const $link = $card.find("a.portfolio-link-wrapper, a[target='_blank']").first();
      const website = $link.attr("href")?.trim();
      if (!website || !/^https?:\/\//i.test(website) || !isCompanyUrl(website)) {
        noWebsite++;
        return;
      }

      // Name is in <h1 class="h4"> sibling of the anchor (not nested inside).
      const name = $card.find("h1.h4, h1, h2, h3").first().text().trim();
      if (!name) {
        noName++;
        return;
      }

      const industry =
        $card.find('p.portfolio-industry-txt, [fs-cmsfilter-field="industry"]').first().text().trim() || null;

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
        investors: ["dcm-ventures"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[DCM] fetchAndParse DONE: ${out.length} kept — ` +
        `${dupe} dupe, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestDCM(): Promise<void> {
  await runIngestor(dcmAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestDCM().finally(() => prisma.$disconnect()).catch(console.error);
}
