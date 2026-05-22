import "dotenv/config";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { withBrowser, renderPage } from "./_lib/playwright-scrape.js";

// M12 (Microsoft's venture arm) portfolio at https://m12.vc/portfolio.
//
// Single-pass: M12 renders all portfolio cards inline with the external
// company URL on each card. Playwright is required because plain curl is
// 403'd by their anti-bot.
//
// Cost: free (~5s page render).
//
// Note: A previous sprint shipped name-extraction via Playwright + Exa
// `category=company` resolution for M12 (134 names through batch 7). This
// adapter supersedes that path with direct URL extraction.

const LISTING_URL = "https://m12.vc/portfolio";

const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)m12\.vc$/i,
  /(?:^|\.)microsoft\.com$/i,
  /(?:^|\.)googletagmanager\.com$/i,
  /(?:^|\.)googleapis\.com$/i,
  /(?:^|\.)gstatic\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)tiktok\.com$/i,
  /(?:^|\.)cookielaw\.org$/i,
  /(?:^|\.)onetrust\.com$/i,
  /(?:^|\.)cookie-script\.com$/i,
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

function nameFromUrl(url: string): string {
  // 1910genetics.com → 1910 Genetics
  // acerta.ai → Acerta
  // openai.com → Openai (caller will not get this case; we have a fallback)
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const stem = host.split(".")[0];
    return stem
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

export const m12Adapter: IngestorAdapter = {
  name: "M12",
  source: "m12",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[M12] Playwright ${LISTING_URL}`);
    const html = await withBrowser(async (browser) => {
      return renderPage(browser, LISTING_URL, {
        scrollToBottom: true,
        waitForTimeout: 15_000,
      });
    });

    const $ = cheerio.load(html);

    // Walk every anchor; collect candidates that look like portfolio company
    // links. M12 puts company URLs as bare anchors inside the portfolio grid
    // (visible in the probe). Each card likely has a logo + name + link, but
    // the link itself is the key signal — every external non-noise href on
    // /portfolio is a portfolio company.
    const seen = new Map<string, { website: string; name: string }>();

    $("a[href^=http]").each((_, el) => {
      const $a = $(el);
      const href = ($a.attr("href") ?? "").trim();
      if (!href || !isCompanyUrl(href)) return;

      let domain: string;
      try {
        domain = new URL(href).hostname.replace(/^www\./, "");
      } catch {
        return;
      }

      if (seen.has(domain)) return;

      // Try to read a name from anchor text or sibling/parent text.
      const aText = $a.text().trim();
      let name: string = aText && aText.length > 1 && aText.length < 80 ? aText : "";

      if (!name) {
        // Look for an img alt
        const alt = $a.find("img").attr("alt")?.trim();
        if (alt && alt.length > 1 && !/logo$/i.test(alt)) {
          name = alt.replace(/\s+logo$/i, "").trim();
        }
      }
      if (!name) {
        // Look for sibling name; in many cases the company name is in the
        // parent card's headline.
        const cardText = $a.parent().text().trim();
        if (cardText && cardText.length > 1 && cardText.length < 80) name = cardText;
      }
      if (!name) name = nameFromUrl(href);

      seen.set(domain, { website: href, name });
    });

    console.log(`[M12] candidate portfolio links found: ${seen.size}`);

    const out: CompanyRecord[] = [];
    for (const [, { website, name }] of seen) {
      out.push({
        name,
        website,
        investors: ["m12"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }

    console.log(`[M12] fetchAndParse DONE: ${out.length} kept`);
    return out;
  },
};

export async function ingestM12(): Promise<void> {
  await runIngestor(m12Adapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestM12().finally(() => prisma.$disconnect()).catch(console.error);
}
