import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// ICONIQ Growth portfolio at https://www.iconiq.com/growth/companies
// (the iconiqcapital.com → iconiq.com redirect resolves on the fly).
// Webflow + Finsweet CMS Filter; the grid renders all companies statically
// inside a single Finsweet-list container. One HTTP fetch yields every card
// twice — once as a grid tile and once as a modal-reveal twin — so the
// adapter dedupes by website URL.
//
// Per-card markup (the active anchor is inside `.companies-list_grid-item-reveal`):
//
//   <div class="companies-list_grid-item w-dyn-item">
//     <div class="companies-list_grid-item-reveal">
//       <a href="https://www.1password.com/" target="_blank"
//          class="companies-list_grid-item-reveal-wrap w-inline-block">
//         <h2 class="heading-style-h3 is-companies">1Password</h2>
//         <div class="text-size-medium text-style-3lines is-companies">Secure, easy-to-use password manager...</div>
//         <div class="hidden-params">
//           <p fs-cmsfilter-field="category">Enterprise SaaS</p>
//           ...
//         </div>
//       </a>
//     </div>
//   </div>
//
// Extraction:
//   - anchor `href`                          → website
//   - `h2.heading-style-h3` text             → name
//   - `.text-size-medium` first child text   → tagline (used as oneLiner)
//
// ICONIQ Growth exposes NO status field — the survey called this out as a
// pure Series B+ roster, so the active assumption is reasonable. If exit
// noise surfaces (the list does include companies that have since IPO'd),
// add an `iconiq.preexistingPublics` block to scripts/_data/skiplists.json
// mirroring the IVP pattern. Deferring; cross-source dedupe already
// absorbs most overlap with sources that DO mark exits.
//
// Stage data is also absent on the page — every row ingests with stage=null,
// same shape as Khosla/IVP/Insight/Wave/Sapphire.

const PORTFOLIO_URL = "https://www.iconiq.com/growth/companies";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const iconiqAdapter: IngestorAdapter = {
  name: "ICONIQ",
  source: "iconiq",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[ICONIQ] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    const out: CompanyRecord[] = [];
    let skippedNoUrl = 0;
    let skippedNoName = 0;
    let skippedDupe = 0;
    const seen = new Set<string>();

    $("a.companies-list_grid-item-reveal-wrap").each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href")?.trim();
      if (!href || !/^https?:\/\//i.test(href)) {
        skippedNoUrl++;
        return;
      }
      // Dedupe twin cards (modal reveal repeats every entry). Domain dedupe in
      // runIngestor would also catch this but we strip it earlier so the
      // candidate counts in the log reflect the unique set.
      let host = "";
      try {
        host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        skippedNoUrl++;
        return;
      }
      if (seen.has(host)) {
        skippedDupe++;
        return;
      }
      seen.add(host);

      const name = $a.find("h2.heading-style-h3").first().text().trim();
      if (!name) { skippedNoName++; return; }
      const tagline = $a.find(".text-size-medium").first().text().trim() || null;

      out.push({
        name,
        website: href,
        oneLiner: tagline,
        investors: ["iconiq"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[ICONIQ] fetchAndParse DONE: ${out.length} kept — ` +
        `${skippedDupe} modal-dupes, ${skippedNoUrl} no-url, ${skippedNoName} no-name`
    );
    return out;
  },
};

export async function ingestIconiq(): Promise<void> {
  await runIngestor(iconiqAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestIconiq().finally(() => prisma.$disconnect()).catch(console.error);
}
