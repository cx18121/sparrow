import "dotenv/config";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { withBrowser, renderPage } from "./_lib/playwright-scrape.js";

// Octopus Ventures (UK) portfolio at https://octopusventures.com/our-portfolio.
//
// WordPress site that's gated three ways:
//   1. /wp-json/wp/v2/* returns 401 (auth-required)
//   2. Static /our-portfolio HTML renders only ~12 cards
//   3. Sector filter buttons (b2b, bio-technology, climate, consumer,
//      deep-tech, fintech, health, pre-seed) trigger AJAX without changing
//      the URL — `?sector=fintech` returns the unfiltered base page
//
// Playwright with scrollToBottom unlocks ~11 fully-formed company cards
// from the default page render. To reach the full ~100+ portfolio we'd
// need a click-each-sector flow, which is meaningful additional code; the
// 11-card static yield is what this adapter ships. Future iteration could
// add sector iteration if the gap matters.
//
// Per-card markup (after Playwright render):
//   <div class="... company-card ...">
//     <h?>About <CompanyName></h?>
//     <img alt="<CompanyName> logo">
//     <a href="https://<company-website>/">…</a>
//   </div>
//
// Name extraction priority:
//   1. img[alt] without " logo" suffix (more reliable — present on every card)
//   2. h? text minus "About " prefix (some cards lack the h? wrapper)
//
// Stage / industry not exposed on the cards — every row ingests with both null.

const PORTFOLIO_URL = "https://octopusventures.com/our-portfolio/";

function nameFromAlt(alt: string): string | null {
  const m = alt.match(/^(.*?)(?:\s+logo)?\s*$/i);
  if (!m || !m[1]) return null;
  const name = m[1].trim();
  return name.length >= 2 ? name : null;
}

function nameFromAboutHeading(text: string): string | null {
  const m = text.match(/^\s*About\s+(.+?)\s*$/i);
  return m ? m[1].trim() : null;
}

export const octopusAdapter: IngestorAdapter = {
  name: "OctopusVentures",
  source: "octopus-ventures",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Octopus] rendering ${PORTFOLIO_URL} via Playwright`);
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

    $(".company-card").each((_, el) => {
      const $card = $(el);

      // Find a real company website inside the card — first http href that
      // isn't an Octopus property or social host.
      let website: string | null = null;
      $card.find("a[href^='http']").each((_, a) => {
        if (website) return;
        const href = $(a).attr("href")?.trim();
        if (!href) return;
        try {
          const host = new URL(href).hostname.toLowerCase();
          if (/(^|\.)octopus(ventures|investments|group|-realestate)?\.com$/.test(host)) return;
          if (/(twitter|linkedin|facebook|instagram|youtube|tiktok|x\.com)/.test(host)) return;
          website = href;
        } catch { /* skip malformed */ }
      });
      if (!website) {
        noWebsite++;
        return;
      }

      // Prefer img[alt] (cleaner across all cards). Fall back to "About X" h?.
      const altRaw = $card.find("img").first().attr("alt")?.trim();
      let name: string | null = altRaw ? nameFromAlt(altRaw) : null;
      if (!name) {
        const heading = $card.find("h1,h2,h3,h4,h5,h6").first().text().trim();
        name = nameFromAboutHeading(heading);
      }
      if (!name) {
        noName++;
        return;
      }

      // Dedupe by website within this run — the swiper carousel can repeat
      // cards across visible/hidden swiper slides.
      const key = website.replace(/\/+$/, "").toLowerCase();
      if (seen.has(key)) {
        dupe++;
        return;
      }
      seen.add(key);

      out.push({
        name,
        website,
        investors: ["octopus-ventures"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[Octopus] fetchAndParse DONE: ${out.length} kept — ` +
        `${dupe} swiper-dupe, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestOctopusVentures(): Promise<void> {
  await runIngestor(octopusAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestOctopusVentures().finally(() => prisma.$disconnect()).catch(console.error);
}
