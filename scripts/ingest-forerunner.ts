import "dotenv/config";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { withBrowser, renderPage } from "./_lib/playwright-scrape.js";

// Forerunner Ventures portfolio at https://www.forerunnerventures.com/portfolio.
// Consumer-focused SF VC. Next.js site that needs JS render for the company
// grid to populate; Playwright with scrollToBottom unlocks ~79 cards.
//
// Per-card markup (Tailwind, no semantic classes):
//   <article class="group bg-lavender/[0.03] border …">
//     <div>
//       <h2 class="font-display text-lg …">Agentio</h2>
//       <span class="text-xs font-mono …">2025</span>     ← year
//     </div>
//     <p class="text-sm text-foreground/60 …">description…</p>
//     <div>
//       <span class="text-xs text-lavender …">Platforms & Infrastructure</span>  ← category
//       <span class="text-xs text-foreground/40 …">AI as Intelligence Layer</span>  ← theme
//     </div>
//     <a href="<external-website>" target="_blank" rel="noopener noreferrer" …>
//       Visit
//     </a>
//   </article>
//
// Extraction: name from the first <h2>, description from first <p>,
// year/category from spans, website from any external <a target="_blank">.
// We use <article> as the card root since the Tailwind classes are too
// volatile to anchor on.

const PORTFOLIO_URL = "https://www.forerunnerventures.com/portfolio";

const NON_COMPANY_HOSTS = [
  /(?:^|\.)forerunnerventures\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)vercel\.app$/i,
];

function isCompanyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !NON_COMPANY_HOSTS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

export const forerunnerAdapter: IngestorAdapter = {
  name: "Forerunner",
  source: "forerunner",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Forerunner] rendering ${PORTFOLIO_URL} via Playwright`);
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

    $("article").each((_, art) => {
      const $art = $(art);

      // Filter out non-portfolio article tags (the page might use <article>
      // for blog post previews too). Require the card to have a target=_blank
      // anchor + an h2 to qualify.
      const $link = $art.find("a[target='_blank']").first();
      if ($link.length === 0) return;
      const $h2 = $art.find("h2").first();
      if ($h2.length === 0) return;

      const website = $link.attr("href")?.trim();
      if (!website || !/^https?:\/\//i.test(website) || !isCompanyUrl(website)) {
        noWebsite++;
        return;
      }

      const name = $h2.text().trim();
      if (!name) {
        noName++;
        return;
      }

      const description = $art.find("p").first().text().trim() || null;

      // Category lives in the first .text-lavender span; theme in the
      // following .text-foreground/40 span. Tailwind opacity slashes don't
      // survive cheerio selectors cleanly, so use the structural ordering:
      // first span next to the link.
      const spans = $art.find("span");
      let industry: string | null = null;
      spans.each((_, sp) => {
        if (industry) return;
        const text = $(sp).text().trim();
        if (!text || /^\d{4}$/.test(text)) return;
        industry = text;
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
        oneLiner: description,
        industry,
        investors: ["forerunner"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[Forerunner] fetchAndParse DONE: ${out.length} kept — ` +
        `${dupe} dupe, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestForerunner(): Promise<void> {
  await runIngestor(forerunnerAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestForerunner().finally(() => prisma.$disconnect()).catch(console.error);
}
