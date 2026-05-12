import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// BoxGroup portfolio at https://www.boxgroup.com/portfolio.
// Webflow CMS; the grid renders all cards (across multiple category tabs)
// statically. Each company appears in several tab panes, so the adapter
// dedupes by website host. Seed-stage focused — low priority for the
// growth-stage gap but a cheap single-fetch add per the survey.
//
// Per-card markup (each card is purely visual — a logo image with no
// surfaced text for the company name):
//
//   <div class="port_tabs-item w-dyn-item">
//     <a href="http://clay.run" class="port_tabs-item_link is-featured w-inline-block">
//       <div style="background-image:url('.../61b80fb3ec1cf16324602f0f_clay.png')"
//            class="port_tabs-item_link-inner"></div>
//       <div class="port-tabs_labels">
//         <div class="port_tabs_box-office [w-condition-invisible]">...</div>
//         <div class="port_tabs-ipo [w-condition-invisible]"><div>IPO</div></div>
//         <div class="port_tabs-acquired [w-condition-invisible]"><div>Exit</div></div>
//       </div>
//     </a>
//   </div>
//
// Extraction:
//   - anchor `href`                                  → website
//   - name derived from the URL host (no text element on the card; the
//     image alt is empty across the whole portfolio)
//
// Exit filter: Webflow CMS hides empty conditional fields with the class
// `w-condition-invisible`. So a card is an EXIT when one of these markers
// is present WITHOUT that "invisible" class:
//   - `<div class="port_tabs-ipo">`        (no w-condition-invisible)
//   - `<div class="port_tabs-acquired">`   (no w-condition-invisible)
// Active cards always have both badges hidden (= both carry
// `w-condition-invisible`).
//
// No stage data on the page, so every active row ingests with stage=null —
// same shape as Khosla/IVP/Insight/ICONIQ/Initialized.

const PORTFOLIO_URL = "https://www.boxgroup.com/portfolio";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CHROME_SUBDOMAINS = new Set([
  "www", "about", "app", "go", "my", "home", "get", "try", "shop",
]);

function deriveNameFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".").filter((p) => !CHROME_SUBDOMAINS.has(p));
    if (parts.length === 0) return null;
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

function isExitCard($card: cheerio.Cheerio<any>): boolean {
  const $ipo = $card.find("div.port_tabs-ipo").first();
  const $acq = $card.find("div.port_tabs-acquired").first();
  if ($ipo.length > 0 && !$ipo.hasClass("w-condition-invisible")) return true;
  if ($acq.length > 0 && !$acq.hasClass("w-condition-invisible")) return true;
  return false;
}

export const boxGroupAdapter: IngestorAdapter = {
  name: "BoxGroup",
  source: "boxgroup",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[BoxGroup] GET ${PORTFOLIO_URL}`);
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
    let skippedDupe = 0;
    const seen = new Set<string>();

    $("div.port_tabs-item.w-dyn-item").each((_, el) => {
      const $card = $(el);
      const $link = $card.find("a.port_tabs-item_link").first();
      const href = $link.attr("href")?.trim();
      if (!href || !/^https?:\/\//i.test(href)) { skippedNoUrl++; return; }

      let host = "";
      try {
        host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        skippedNoUrl++;
        return;
      }
      if (seen.has(host)) { skippedDupe++; return; }
      seen.add(host);

      if (isExitCard($card)) { skippedExit++; return; }

      const name = deriveNameFromUrl(href);
      if (!name) { skippedNoName++; return; }

      out.push({
        name,
        website: href,
        investors: ["boxgroup"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[BoxGroup] fetchAndParse DONE: ${out.length} kept — ` +
        `${skippedExit} exits, ${skippedDupe} cross-tab dupes, ${skippedNoUrl} no-url, ${skippedNoName} no-name`
    );
    return out;
  },
};

export async function ingestBoxGroup(): Promise<void> {
  await runIngestor(boxGroupAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestBoxGroup().finally(() => prisma.$disconnect()).catch(console.error);
}
