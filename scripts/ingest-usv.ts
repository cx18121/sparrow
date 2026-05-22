import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Union Square Ventures (USV) portfolio at https://www.usv.com/companies.
// WordPress site rendering the full portfolio inline as one static table —
// no detail-page hop, no pagination, no JS needed. ~202 portfolio companies.
//
// Per-row markup:
//   <div class="m__list-row ">                  ← desktop row
//     <div class="m__list-row__col">…logo…</div>
//     <div class="m__list-row__col">
//       <a href="<external-website>" target="_blank">CompanyName</a>
//       <span class="exit-detail"></span>       ← non-empty when exit
//     </div>
//     <div class="m__list-row__col">Series A, 2019</div>  ← stage + year
//     <div class="m__list-row__col">
//       <div class="m__list-row__excerpt">description…</div>
//     </div>
//     <div class="m__list-row__col">… "Read the Post" …</div>
//   </div>
//
// The page also includes parallel `m__list-row--mobile` rows that mirror
// each desktop row. Dedupe by selecting only non-mobile rows (the desktop
// rows carry both the website href and the description).
//
// Stage parse: "Series A, 2019" → stage="Series A". Standard format —
// "Seed", "Series A", "Series B", "Series C", "Pre-Seed", "Growth", etc.

const PORTFOLIO_URL = "https://www.usv.com/companies";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOSTS = [
  /(?:^|\.)usv\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
];

function isCompanyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !NON_COMPANY_HOSTS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

// Parse "Series A, 2019" / "Seed, 2018" / "Series C, 2020" → stage label
// in USV's already-canonical form (matches Sparrow's STAGE_INFERRED enum).
function parseStage(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^\s*(Pre-Seed|Seed|Series\s+[A-Z]\+?|Growth)\b/i);
  if (!m) return null;
  // Normalize "series a" → "Series A"
  return m[1].replace(/series\s+/i, "Series ").replace(/series\s+([a-z])/i,
    (_, l) => `Series ${l.toUpperCase()}`);
}

export const usvAdapter: IngestorAdapter = {
  name: "USV",
  source: "usv",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[USV] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(html);
    const out: CompanyRecord[] = [];
    const seen = new Set<string>();

    let exits = 0;
    let noName = 0;
    let noWebsite = 0;
    let dupe = 0;

    // Desktop rows only — mobile rows have the same name but no description
    // and no external website href on them.
    $(".m__list-row").not(".m__list-row--mobile").each((_, el) => {
      const $row = $(el);

      // Name + website live together in the same <a> tag.
      const $nameLink = $row.find("a[target='_blank']").first();
      const name = $nameLink.text().trim();
      const website = $nameLink.attr("href")?.trim();

      if (!name) {
        noName++;
        return;
      }
      if (!website || !/^https?:\/\//i.test(website) || !isCompanyUrl(website)) {
        noWebsite++;
        return;
      }

      // Exit filter — exit-detail span has text when company was acquired/IPO.
      const exitDetail = $row.find(".exit-detail").first().text().trim();
      if (exitDetail) {
        exits++;
        return;
      }

      // Stage + year from the 3rd column.
      // Structure: 5 cols (logo, name, stage+year, excerpt, read-post-link).
      const cols = $row.find(".m__list-row__col");
      const stageText = $(cols.get(2)).text().trim();
      const stage = parseStage(stageText);

      // Description from excerpt block.
      const description =
        $row.find(".m__list-row__excerpt").first().text().trim() || null;

      const key = website.replace(/\/+$/, "").toLowerCase();
      if (seen.has(key)) {
        dupe++;
        return;
      }
      seen.add(key);

      out.push({
        name,
        website,
        stage,
        oneLiner: description,
        investors: ["usv"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[USV] fetchAndParse DONE: ${out.length} kept — ` +
        `${exits} exits, ${dupe} dupe, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestUSV(): Promise<void> {
  await runIngestor(usvAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestUSV().finally(() => prisma.$disconnect()).catch(console.error);
}
