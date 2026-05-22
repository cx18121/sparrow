import "dotenv/config";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { withBrowser, renderPage } from "./_lib/playwright-scrape.js";

// True Ventures portfolio at https://www.trueventures.com/portfolio.
//
// Next.js 13+ App Router with React Server Components — the company list is
// streamed in via `self.__next_f` pushes that aren't easily parseable from
// raw HTML. Playwright renders the hydrated DOM cleanly.
//
// After render, the "All" grid section exposes one anchor per portfolio
// company:
//   <a href="https://<company-website>"
//      aria-label="<CompanyName> (opens in new tab)"
//      class="group flex h-20 ...">
//     <div class="...">
//       <img src="/logos/<slug>.svg|.png|.webp"
//            alt="<CompanyName>"
//            ...>
//     </div>
//   </a>
//
// Per-anchor extraction (priority order — both should be present):
//   1. aria-label minus " (opens in new tab)" suffix → name
//   2. img[alt] → name (fallback if aria-label is missing)
//   3. href → website
//
// Exits/active aren't discriminated — True's grid mixes them (Peloton,
// HashiCorp, Duo, MakerBot are exits but render as regular cards). No
// PREEXISTING_PUBLICS skiplist; cross-source dedupe in runIngestor absorbs
// the IPO/acquired overlap with sources that DO mark exits (a16z, IVP).

const PORTFOLIO_URL = "https://www.trueventures.com/portfolio";

function nameFromAriaLabel(label: string): string | null {
  // "Aristotle (opens in new tab)" → "Aristotle"
  const m = label.match(/^(.+?)\s*\(opens in new tab\)\s*$/i);
  if (m) return m[1].trim();
  return label.trim() || null;
}

// Filter hosts that aren't portfolio companies (True's own infra, social).
const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)trueventures\.com$/i,
  /(?:^|\.)trueventures\.ai$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)tiktok\.com$/i,
  /(?:^|\.)medium\.com$/i,
  /(?:^|\.)vercel\.app$/i,
];

function isCompanyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !NON_COMPANY_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

export const trueVenturesAdapter: IngestorAdapter = {
  name: "TrueVentures",
  source: "true-ventures",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[True] rendering ${PORTFOLIO_URL} via Playwright`);
    const html = await withBrowser((browser) =>
      renderPage(browser, PORTFOLIO_URL, {
        scrollToBottom: true,
        waitForTimeout: 8000,
      })
    );

    const $ = cheerio.load(html);
    const out: CompanyRecord[] = [];
    const seen = new Set<string>();

    let noWebsite = 0;
    let noName = 0;
    let dupe = 0;
    let nonCompanyHost = 0;

    // Two grids on the page: a "Highlights" section with rich text and the
    // "All" logo grid. Both use anchors with aria-label="<Name> (opens in
    // new tab)" — iterate over every such anchor, dedupe by website.
    $("a[aria-label]").each((_, el) => {
      const $a = $(el);
      const ariaLabel = $a.attr("aria-label")?.trim() ?? "";
      if (!/\(opens in new tab\)\s*$/i.test(ariaLabel)) return;

      const href = $a.attr("href")?.trim();
      if (!href || !/^https?:\/\//i.test(href)) {
        noWebsite++;
        return;
      }
      if (!isCompanyUrl(href)) {
        nonCompanyHost++;
        return;
      }

      let name = nameFromAriaLabel(ariaLabel);
      if (!name) {
        // Fallback to img alt.
        name = $a.find("img").first().attr("alt")?.trim() ?? null;
      }
      if (!name) {
        noName++;
        return;
      }

      const key = href.replace(/\/+$/, "").toLowerCase();
      if (seen.has(key)) {
        dupe++;
        return;
      }
      seen.add(key);

      out.push({
        name,
        website: href,
        investors: ["true-ventures"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[True] fetchAndParse DONE: ${out.length} kept — ` +
        `${dupe} dupe, ${noName} no-name, ${noWebsite} no-website, ${nonCompanyHost} non-company host`
    );
    return out;
  },
};

export async function ingestTrueVentures(): Promise<void> {
  await runIngestor(trueVenturesAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestTrueVentures().finally(() => prisma.$disconnect()).catch(console.error);
}
