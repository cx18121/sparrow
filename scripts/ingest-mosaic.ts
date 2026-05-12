import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Mosaic Ventures portfolio at https://www.mosaicventures.com/portfolio/.
// Squarespace single-page (~2.3 MB) — every portfolio company renders inline
// as a `<div class="list-item-content__description">` block. One HTTP fetch
// yields the full list. European late-stage focus.
//
// Per-card structure:
//
//   <div class="list-item-content__description ..."> ...
//     <p><a href="https://www.parloa.com/"><strong>Parloa</strong></a></p>
//     <p>Tagline goes here</p>
//     <p>Founded, 2018<br>Partnered, 2022</p>
//     <!-- optional, when exited: -->
//     <p><u>Acquired by Microsoft, 2024</u></p>
//   </div>
//
// Extraction:
//   - first `<a href>` inside the card        → website
//   - `<strong>` text inside that anchor      → name
//   - second `<p>` text                       → tagline (used as oneLiner)
//
// Exit filter: a non-empty card body containing "Acquired by", "IPO",
// "Exited", or "Acquisition" → skip. Mosaic flags exits inline in the
// description rather than in a separate status field, so the regex is the
// authoritative signal. Probe stats: 64 cards → ~30 exits → ~34 active.
//
// No stage data on the page, so every row ingests with stage=null.

const PORTFOLIO_URL = "https://www.mosaicventures.com/portfolio/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const EXIT_RE = /\b(Acquired by|IPO|Exited|Acquisition)\b/i;

export const mosaicAdapter: IngestorAdapter = {
  name: "Mosaic",
  source: "mosaic",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Mosaic] GET ${PORTFOLIO_URL}`);
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
    let skippedNoStrong = 0;

    $("div.list-item-content__description").each((_, el) => {
      const $card = $(el);
      const bodyText = $card.text();
      if (EXIT_RE.test(bodyText)) { skippedExit++; return; }

      const $a = $card.find("a[href^='http']").first();
      const href = $a.attr("href")?.trim();
      if (!href || !/^https?:\/\//i.test(href)) { skippedNoUrl++; return; }

      const $strong = $a.find("strong").first();
      const name = ($strong.length ? $strong.text() : $a.text()).trim();
      if (!name) {
        if (!$strong.length) skippedNoStrong++;
        else skippedNoName++;
        return;
      }

      // Pull the *second* <p> as the tagline. Mosaic's pattern: first <p>
      // wraps the company anchor, second <p> is the description.
      const paragraphs = $card.find("p").toArray();
      let tagline: string | null = null;
      for (let i = 1; i < paragraphs.length; i++) {
        const text = $(paragraphs[i]).text().trim();
        if (!text) continue;
        if (/^Founded,/i.test(text)) continue;
        tagline = text.slice(0, 240);
        break;
      }

      out.push({
        name,
        website: href,
        oneLiner: tagline,
        investors: ["mosaic"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[Mosaic] fetchAndParse DONE: ${out.length} kept — ` +
        `${skippedExit} exits, ${skippedNoUrl} no-url, ${skippedNoName} no-name, ${skippedNoStrong} no-strong`
    );
    return out;
  },
};

export async function ingestMosaic(): Promise<void> {
  await runIngestor(mosaicAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestMosaic().finally(() => prisma.$disconnect()).catch(console.error);
}
