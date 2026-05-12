import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Hoxton Ventures portfolio at https://hoxtonventures.com/portfolio.
// UK seed-stage firm. WordPress + Yoast with `wp/v2/portfolio` REST endpoint
// publicly exposed (`X-WP-Total: 94`). Pure REST crawl — no detail-page hop,
// no HTML scraping.
//
// Per-row REST response:
//
//   {
//     id, slug, link,
//     title.rendered  → company name
//     content.rendered:
//       <p>Powering diagnostics and life sciences ...</p>     ← tagline
//       <p>panaceadiagnostics.co.uk</p>                       ← website (bare domain)
//       <p>&nbsp;</p>
//   }
//
// Extraction:
//   - title.rendered                 → name
//   - first <p> of content           → tagline
//   - second <p> of content          → website (force https:// prefix if absent)
//
// Hoxton's REST does not expose a status/exit field — UK seed-stage roster
// with limited exit history. Cross-source dedupe absorbs known exits.
//
// No stage data, so every row ingests with stage=null — same as the
// majority of the other adapters.

const LIST_URL = "https://hoxtonventures.com/wp-json/wp/v2/portfolio";
const PER_PAGE = 100;
const REQUEST_DELAY_MS = 600;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface HoxtonItem {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
}

async function fetchPage(page: number): Promise<HoxtonItem[]> {
  const { data } = await axios.get<HoxtonItem[]>(LIST_URL, {
    params: { per_page: PER_PAGE, page, _fields: "id,slug,title,link,content" },
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  return data;
}

// Pull the website out of the content HTML. Hoxton stores it as a bare
// domain string inside a `<p>` (e.g. `panaceadiagnostics.co.uk`) — sometimes
// it's a full URL with scheme. Defensive: take the first `<p>` that looks
// domain-shaped (contains a dot, no spaces), prefix `https://` if missing.
function extractWebsite(contentHtml: string): string | null {
  const $ = cheerio.load(contentHtml);
  const paragraphs = $("p").toArray();
  for (const p of paragraphs) {
    const text = $(p).text().trim();
    if (!text || text.length > 120) continue;
    if (/\s/.test(text)) continue;
    if (!/\./.test(text)) continue;
    // Looks domain-shaped. Normalize to https URL.
    if (/^https?:\/\//i.test(text)) return text;
    return `https://${text.replace(/^\/+/, "")}`;
  }
  return null;
}

function extractTagline(contentHtml: string): string | null {
  const $ = cheerio.load(contentHtml);
  const firstP = $("p").first().text().trim();
  return firstP && firstP.length > 0 ? firstP.slice(0, 240) : null;
}

export const hoxtonAdapter: IngestorAdapter = {
  name: "Hoxton",
  source: "hoxton",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const items: HoxtonItem[] = [];
    let page = 1;
    while (true) {
      let batch: HoxtonItem[];
      try {
        batch = await fetchPage(page);
      } catch (err: any) {
        if (err?.response?.status === 400) break;
        throw err;
      }
      if (batch.length === 0) break;
      items.push(...batch);
      console.log(`[Hoxton] list page ${page}: +${batch.length} (total ${items.length})`);
      if (batch.length < PER_PAGE) break;
      page++;
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }

    const out: CompanyRecord[] = [];
    let missingName = 0;
    let missingWebsite = 0;
    for (const it of items) {
      const name = cheerio.load(`<x>${it.title.rendered}</x>`)("x").text().trim();
      if (!name) { missingName++; continue; }
      const website = extractWebsite(it.content.rendered);
      if (!website) { missingWebsite++; continue; }
      const tagline = extractTagline(it.content.rendered);

      out.push({
        name,
        website,
        oneLiner: tagline,
        sourceId: it.slug,
        investors: ["hoxton"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }

    console.log(
      `[Hoxton] fetchAndParse DONE: ${out.length} kept of ${items.length} items — ` +
        `${missingName} no-name, ${missingWebsite} no-website`
    );
    return out;
  },
};

export async function ingestHoxton(): Promise<void> {
  await runIngestor(hoxtonAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestHoxton().finally(() => prisma.$disconnect()).catch(console.error);
}
