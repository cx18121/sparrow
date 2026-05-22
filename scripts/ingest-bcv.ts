import "dotenv/config";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { withBrowser } from "./_lib/playwright-scrape.js";

// Bain Capital Ventures (BCV) portfolio at
// https://www.baincapitalventures.com/portfolio.
//
// BCV's public /portfolio is intentionally a small curated subset
// (~24 unique companies as of 2026-05-22), not their full ~250 active
// investments. The page renders the cards with the external company URL
// inline (sr-only span: "<Name> - <description>"). After clicking
// "Load more" once and scrolling, the full visible set is in the DOM.
//
// We accept BCV's narrow window — surfaced rows are all current/featured.
// Filling the rest of BCV's portfolio would require Crunchbase / paid
// data, out of scope.
//
// Cost: free (~10s Playwright render + 1 click).

const LISTING_URL = "https://www.baincapitalventures.com/portfolio";

const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)baincapitalventures\.com$/i,
  /(?:^|\.)baincapital\.com$/i,
  /(?:^|\.)googletagmanager\.com$/i,
  /(?:^|\.)googleapis\.com$/i,
  /(?:^|\.)gstatic\.com$/i,
  /(?:^|\.)business\.safety\.google$/i,
  /(?:^|\.)google\.com$/i,
  /(?:^|\.)cookiebot\.com$/i,
  /(?:^|\.)cookielaw\.org$/i,
  /(?:^|\.)onetrust\.com$/i,
  /(?:^|\.)vimeo\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)tiktok\.com$/i,
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

export const bcvAdapter: IngestorAdapter = {
  name: "BCV",
  source: "bcv",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[BCV] Playwright ${LISTING_URL}`);

    const html = await withBrowser(async (browser) => {
      const ctx = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1440, height: 900 },
      });
      const page = await ctx.newPage();
      try {
        await page.goto(LISTING_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

        // Click "Load more" repeatedly until it stops adding cards.
        for (let i = 0; i < 40; i++) {
          const btn = page.locator('button:has-text("Load more")').first();
          if (!(await btn.isVisible().catch(() => false))) break;
          const before = await page.evaluate(() => document.querySelectorAll('a[href^="https://"]').length);
          await btn.click().catch(() => {});
          await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
          const after = await page.evaluate(() => document.querySelectorAll('a[href^="https://"]').length);
          if (after <= before) break;
        }

        return await page.content();
      } finally {
        await ctx.close();
      }
    });

    const $ = cheerio.load(html);

    // BCV's cards expose the external URL via two parallel module trees
    // (portfolio_card_list-module + portfolio_card-module — desktop +
    // mobile renders). Both wrap an <a class="...__link" href="<url>">
    // followed by <span class="sr-only">Name - Description</span>.
    interface Row { website: string; name: string; description: string | null }
    const byDomain = new Map<string, Row>();

    // BCV duplicates each card across desktop + mobile renders with two
    // different module-scss class hashes; rather than enumerate them, we
    // sweep ALL external anchors on the page and rely on isCompanyUrl()
    // + the sr-only "<Name> - <Description>" sibling pattern (when present)
    // to distinguish portfolio cards from chrome.
    $('a[href^="https://"]').each((_, el) => {
      const $a = $(el);
      const href = ($a.attr("href") ?? "").trim();
      if (!href || !isCompanyUrl(href)) return;
      let domain: string;
      try {
        domain = new URL(href).hostname.replace(/^www\./, "");
      } catch {
        return;
      }
      if (byDomain.has(domain)) return;

      // Read the sr-only span. Format: "<Name> - <Description>" or just
      // "<Name>". The literal " - " separator is rendered by React as
      // "<!-- -->-<!-- -->" but cheerio's .text() flattens it back.
      const sr = $a.find(".sr-only").first().text().trim();
      let name = "";
      let description: string | null = null;
      if (sr) {
        const parts = sr.split(/\s+-\s+/);
        name = parts[0].trim();
        if (parts.length > 1) description = parts.slice(1).join(" - ").trim();
      }
      if (!name) {
        // Fallback: derive from domain stem.
        name = domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
      // Only keep anchors that either have an sr-only label (portfolio card
      // marker) or whose domain is sufficiently unique. Without the
      // sr-only, the anchor could be footer / navigation noise. We require
      // the parent or grandparent to have a portfolio-related class.
      if (!sr) {
        const parentClass = $a.parent().attr("class") ?? "";
        const grandClass = $a.parent().parent().attr("class") ?? "";
        if (!/portfolio|company|companies_grid/i.test(parentClass + " " + grandClass)) return;
      }
      byDomain.set(domain, { website: href, name, description });
    });

    console.log(`[BCV] unique company links found: ${byDomain.size}`);

    const out: CompanyRecord[] = [];
    for (const [, r] of byDomain) {
      out.push({
        name: r.name,
        website: r.website,
        oneLiner: r.description,
        investors: ["bcv"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    console.log(`[BCV] fetchAndParse DONE: ${out.length} kept`);
    return out;
  },
};

export async function ingestBcv(): Promise<void> {
  await runIngestor(bcvAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestBcv().finally(() => prisma.$disconnect()).catch(console.error);
}
