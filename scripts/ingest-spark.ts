import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Spark Capital portfolio at https://www.sparkcapital.com/companies.
// Webflow CMS; the grid renders all companies statically. Cards appear
// duplicated (~3× per company — grid tile + modal + mobile twin), so the
// adapter dedupes by website host. ~144 cards → ~56 unique companies.
//
// Per-card markup inside `<div class="collection-item w-dyn-item">`:
//
//   <h3 class="h3">Twitter</h3>
//   <div class="company-specs spacing---extra-small">Twitter is what's happening...</div>
//   <div class="acquisition-spec">NYSE: TWTR in 2013</div>      ← EXIT marker (optional)
//   <a href="https://twitter.com/home" class="company-link">Visit the Website</a>
//
// Exit filter: a non-empty `<div class="acquisition-spec">` means the
// company has IPO'd ("NYSE: ... in YYYY" / "NASDAQ: ... in YYYY") or been
// acquired ("Acquired by ... in YYYY"). Survey distribution across 144
// cards: 114 empty (active), 16 "Acquired by ...", 14 "NYSE/NASDAQ: ...".
//
// Spark's roster skews late-stage (Anthropic, Discord, Affirm, Slack). No
// stage data on the page, so every active row ingests with stage=null —
// same shape as Khosla/IVP/Insight/Wave/Sapphire/ICONIQ.

const PORTFOLIO_URL = "https://www.sparkcapital.com/companies";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const sparkAdapter: IngestorAdapter = {
  name: "Spark",
  source: "spark",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Spark] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    const out: CompanyRecord[] = [];
    let skippedExit = 0;
    let skippedDupe = 0;
    let skippedNoUrl = 0;
    let skippedNoName = 0;
    const seen = new Set<string>();

    $("div.collection-item.w-dyn-item").each((_, el) => {
      const $card = $(el);
      const $link = $card.find("a.company-link").first();
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

      const exit = $card.find("div.acquisition-spec").first().text().trim();
      if (exit) { skippedExit++; return; }

      const name = $card.find("h3.h3").first().text().trim();
      if (!name) { skippedNoName++; return; }
      const tagline = $card.find("div.company-specs").first().text().trim() || null;

      out.push({
        name,
        website: href,
        oneLiner: tagline,
        investors: ["spark"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[Spark] fetchAndParse DONE: ${out.length} kept — ` +
        `${skippedExit} exits, ${skippedDupe} card-dupes, ${skippedNoUrl} no-url, ${skippedNoName} no-name`
    );
    return out;
  },
};

export async function ingestSpark(): Promise<void> {
  await runIngestor(sparkAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestSpark().finally(() => prisma.$disconnect()).catch(console.error);
}
