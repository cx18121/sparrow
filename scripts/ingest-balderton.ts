import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Balderton Capital portfolio at https://www.balderton.com/companies/.
// WordPress + FacetWP. The page advertises `total_rows: 200`, but the
// initial server render only includes ~30 cards — the rest are
// incrementally loaded via FacetWP's AJAX endpoint
// (`/wp-json/facetwp/v1/refresh`), which is gated behind a per-session
// nonce + opaque template state that doesn't reconstruct from a clean POST.
//
// **Partial coverage.** This adapter takes only the server-rendered set
// (~30 most-recent/featured cards). Replicating the FacetWP AJAX requires
// either a Playwright session or reverse-engineering a working nonce flow,
// neither of which is worth the complexity for an incremental ~170 rows.
// If wider coverage matters, revisit with Playwright or a documented FacetWP
// endpoint pattern.
//
// Per-card markup (rich metadata in the CSS class plus a structured body):
//
//   <div class="card ... company type-company status-publish ...
//               location-france status-live sector-enterprise">
//     <img src=".../Aircall.png" ... />
//     <div class="mask ...">
//       <span class="label-M ...">Paris, France</span>
//       <div>
//         <h3 id="aircall">Aircall</h3>
//         <div class="text-powder body-s"><p>Aircall provides an integrated, easy to use, cloud-based phone solution</p></div>
//         <ul class="list-inline m-0">
//           <li><span class="label-m fw-medium">Series A in 2016</span></li>
//         </ul>
//       </div>
//     </div>
//     <a class="mask" href="https://aircall.io/" target="_blank"></a>
//   </div>
//
// Extraction:
//   - card `class` contains `status-live` (active) vs `status-exited` (skip).
//   - `<h3>` text                                     → name
//   - `<div class="text-powder">` first <p>           → tagline (oneLiner)
//   - `<a class="mask" target="_blank">` href         → website
//   - `<li><span class="label-m">Series X in YYYY</span></li>` → stage signal,
//     normalized via mapStage()

const PORTFOLIO_URL = "https://www.balderton.com/companies/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Parse the stage label out of "Series A in 2016", "Seed in 2018", etc.
// Map to Sparrow's canonical buckets (Seed / Series A / Series B / Series C+).
function mapStage(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/\bseed\b|\bpre-seed\b|\bpreseed\b/i.test(s)) return "Seed";
  if (/\bseries\s+a\b/i.test(s)) return "Series A";
  if (/\bseries\s+b\b/i.test(s)) return "Series B";
  if (/\bseries\s+(c|d|e|f|g)\+?\b|\bgrowth\b|\blate\b/i.test(s)) return "Series C+";
  return null;
}

export const baldertonAdapter: IngestorAdapter = {
  name: "Balderton",
  source: "balderton",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Balderton] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    const out: CompanyRecord[] = [];
    let skippedExit = 0;
    let skippedNoUrl = 0;
    let skippedNoName = 0;

    $("div.card.company.type-company").each((_, el) => {
      const $card = $(el);
      const cls = $card.attr("class") ?? "";
      if (/\bstatus-exited\b/i.test(cls)) {
        skippedExit++;
        return;
      }
      // Anything that isn't explicitly status-live or carries an
      // unrecognized status flag — be conservative, only keep status-live.
      if (!/\bstatus-live\b/i.test(cls)) return;

      const href = $card.find("a.mask[href^='http']").first().attr("href")?.trim();
      if (!href) { skippedNoUrl++; return; }

      const name = $card.find("h3").first().text().trim();
      if (!name) { skippedNoName++; return; }

      const tagline = $card.find("div.text-powder p").first().text().trim() || null;
      const stageLabel = $card.find("ul.list-inline li span").first().text().trim() || null;

      out.push({
        name,
        website: href,
        oneLiner: tagline,
        stage: mapStage(stageLabel),
        investors: ["balderton"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[Balderton] fetchAndParse DONE: ${out.length} kept — ` +
        `${skippedExit} exits, ${skippedNoUrl} no-url, ${skippedNoName} no-name`
    );
    return out;
  },
};

export async function ingestBalderton(): Promise<void> {
  await runIngestor(baldertonAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestBalderton().finally(() => prisma.$disconnect()).catch(console.error);
}
