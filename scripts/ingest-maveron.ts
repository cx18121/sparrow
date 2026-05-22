import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Maveron portfolio at https://www.maveron.com/portfolio. Consumer-focused
// SF/Seattle VC. Webflow site rendering the full portfolio inline grouped
// by status ("active" / "exited").
//
// Per-item markup:
//   <h2 class="portfolio-group-header">active</h2>
//   <div class="w-dyn-list">
//     <div role="list" class="w-dyn-items">
//       <div role="listitem" class="w-dyn-item">
//         <a href="<website>" target="_blank" class="w-inline-block">
//           <div class="portfolio-group-item">CompanyName</div>
//         </a>
//       </div>
//       …
//     </div>
//   </div>
//
// Then a second h2 "exited" with the same structure for exits. Filter by
// nearest preceding portfolio-group-header.

const PORTFOLIO_URL = "https://www.maveron.com/portfolio";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const maveronAdapter: IngestorAdapter = {
  name: "Maveron",
  source: "maveron",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Maveron] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(html);
    const out: CompanyRecord[] = [];
    const seen = new Set<string>();

    let nonActive = 0;
    let noName = 0;
    let noWebsite = 0;
    let dupe = 0;

    // Walk the tab-pane content for the "All" tab. Each portfolio-group has
    // its header h2 + a w-dyn-list of items. Status comes from the header.
    $(".portfolio-group").each((_, group) => {
      const $group = $(group);
      const header = $group.find(".portfolio-group-header").first().text().trim().toLowerCase();
      const isActive = header === "active";

      $group.find(".w-dyn-item").each((_, item) => {
        const $item = $(item);
        if (!isActive) {
          nonActive++;
          return;
        }

        const $a = $item.find("a[target='_blank']").first();
        const website = $a.attr("href")?.trim();
        const name = $a.find(".portfolio-group-item").first().text().trim();

        if (!name) {
          noName++;
          return;
        }
        if (!website || !/^https?:\/\//i.test(website)) {
          noWebsite++;
          return;
        }

        const key = website.replace(/\/+$/, "").toLowerCase();
        if (seen.has(key)) {
          dupe++;
          return;
        }
        seen.add(key);

        out.push({
          name,
          website,
          investors: ["maveron"],
          signals: ["vc-backed"],
          isVerified: true,
        });
      });
    });

    console.log(
      `[Maveron] fetchAndParse DONE: ${out.length} kept — ` +
        `${nonActive} exits, ${dupe} dupe, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestMaveron(): Promise<void> {
  await runIngestor(maveronAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestMaveron().finally(() => prisma.$disconnect()).catch(console.error);
}
