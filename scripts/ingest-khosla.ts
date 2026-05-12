import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Khosla Ventures portfolio at https://www.khoslaventures.com/portfolio.
// Webflow-built site; the entire portfolio renders inline as a static cards
// grid (Splide carousel under the hood, but the underlying DOM exposes every
// row whether or not the carousel reveals it). One HTTP fetch yields the
// full list — no detail-page hop, no pagination, no JS execution required.
//
// Per-card markup:
//
//   <a style="background-color:#5229f6"
//      href="https://openai.com/"
//      class="company-slide w-inline-block">
//     <img src="..." alt="OpenAI"/>
//     <div class="text-block-17">AI benefiting humanity</div>
//   </a>
//
// Extraction:
//   - `href` (anchor)                    → website (always present)
//   - `<img alt>` (first child)          → display name (~15 of ~132 cards)
//   - `<div class="text-block-17">`      → tagline (always present)
//
// Name fallback: ~117 of ~132 cards have `alt=""`. The card has no other
// text element carrying the company name, so the name has to be derived
// from the registered domain (second-to-last label of the URL hostname,
// hyphens split to spaces, title-cased). This is imperfect for multi-word
// concatenated domains (physicalintelligence.company → "Physicalintelligence")
// — accept the cosmetic loss; cleaner naming would require a Crunchbase-like
// enrichment pass, which the project has explicitly de-scoped.
//
// Khosla exposes NO status field on the portfolio page — exited and active
// companies are mixed together with no source-side discriminator. Notable
// IPOs in the list (DoorDash, GitLab, Affirm, Block, Instacart, Rubrik,
// Upstart, Oscar Health, Quantumscape, LanzaTech, etc.) will ingest as
// active, just as they do from the prior Khosla-pre-IPO investment record.
// If exit noise proves to be a problem, add a `khosla.preexistingPublics`
// block to `scripts/_data/skiplists.json` keyed by hostname (mirrors the IVP
// pattern). Deferring that curation work; the upserter's per-domain dedupe
// already absorbs most overlap with sources that DO mark exits (a16z, IVP,
// Coatue).
//
// Stage data is also absent on the page — every row ingests with stage=null,
// same shape as IVP/Insight/Wave.

const PORTFOLIO_URL = "https://www.khoslaventures.com/portfolio";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Subdomain labels that are never the registered name. When the URL is
// `https://about.gitlab.com/`, the registered domain part is `gitlab`, not
// `about`. The second-to-last-label heuristic below already drops the TLD,
// so we only need to skip explicit chrome subdomains here.
const CHROME_SUBDOMAINS = new Set([
  "www", "about", "app", "go", "my", "home", "get", "try", "shop",
]);

// Derive a display name from the company URL. Used when the card's `<img alt>`
// is empty, which is the case for ~90% of Khosla cards. Best-effort only —
// loses CamelCase splits (vectranetworks → "Vectranetworks") and can't
// reconstruct proper-noun spacing for multi-word concatenated domains.
function deriveNameFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    let parts = host.split(".").filter((p) => !CHROME_SUBDOMAINS.has(p));
    if (parts.length === 0) return null;
    // Drop TLD. For abc.xyz → ['abc','xyz'] → 'abc'. For about.gitlab.com
    // (after `about` filter) → ['gitlab','com'] → 'gitlab'.
    const label =
      parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1];
    if (!label) return null;
    return label
      .split("-")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  } catch {
    return null;
  }
}

export const khoslaAdapter: IngestorAdapter = {
  name: "Khosla",
  source: "khosla",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Khosla] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    const out: CompanyRecord[] = [];
    let missingUrl = 0;
    let missingName = 0;
    let derivedName = 0;

    $("a.company-slide").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href")?.trim();
      if (!href || !/^https?:\/\//i.test(href)) {
        missingUrl++;
        return;
      }
      const altRaw = $el.find("img").first().attr("alt")?.trim();
      let name = altRaw && altRaw.length > 0 ? altRaw : null;
      if (!name) {
        name = deriveNameFromUrl(href);
        if (name) derivedName++;
      }
      if (!name) {
        missingName++;
        return;
      }
      const tagline = $el.find(".text-block-17").first().text().trim() || null;

      out.push({
        name,
        website: href,
        oneLiner: tagline,
        investors: ["khosla"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[Khosla] fetchAndParse DONE: ${out.length} kept — ` +
        `${derivedName} url-derived names, ${missingUrl} no-url, ${missingName} no-name`
    );
    return out;
  },
};

export async function ingestKhosla(): Promise<void> {
  await runIngestor(khoslaAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestKhosla().finally(() => prisma.$disconnect()).catch(console.error);
}
