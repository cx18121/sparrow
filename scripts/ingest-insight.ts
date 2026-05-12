import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Insight Partners portfolio at https://www.insightpartners.com/portfolio/.
// The public /portfolio listing is a Vue shell — the company grid is rendered
// client-side and doesn't survive a plain HTTP fetch. Research in
// docs/scraping-research.md Part 2 flagged this as Tier-2 "needs Playwright".
//
// Better path discovered while scoping Step 8: Insight is WordPress + a custom
// post type `sfcompany`. Two REST endpoints expose everything we need without
// a headless browser:
//
//   GET /wp-json/wp/v2/sfcompany?per_page=100&page=N&_fields=id,slug,title,link
//       — paginated list of all 845 portfolio entries (id, slug, name).
//
//   GET /wp-json/insight/v1/get-company-content?id=<id>
//       — returns { request, content } where `content` is the rendered company
//         section HTML. Carries the Status field and the canonical website
//         anchor; the public-facing detail page just loads the same blob via
//         XHR at runtime.
//
// Two-step plan:
//   1. Page through /wp/v2/sfcompany (9 pages × 100) to harvest every company
//      id+slug+name.
//   2. For each id, fetch the custom content endpoint, parse:
//        - status: "Current Investment" → keep; "Prior Investment" → exit.
//        - website: the anchor that *contains* an `svg.svg-icon__new-window`.
//          All other anchors in that block point to social handles ("Learn
//          More About <Name>" titles are reused for every anchor, so the SVG
//          glyph is the only reliable discriminator).
//
// Insight exposes no stage data on either endpoint, so every surviving row
// ingests with stage=null — same shape as IVP. Status is a categorical CMS
// field maintained by Insight, so no PREEXISTING_PUBLICS skiplist is needed
// (unlike IVP, whose `Founded ... | Partnered ...` summary only flags exits
// that happened during the investment window).

const LIST_URL = "https://www.insightpartners.com/wp-json/wp/v2/sfcompany";
const CONTENT_URL =
  "https://www.insightpartners.com/wp-json/insight/v1/get-company-content";
const PER_PAGE = 100;
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface SfCompanyListItem {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
}

interface PortfolioEntry {
  id: number;
  slug: string;
  name: string;
}

// The /insight/v1 endpoints return responses that are sometimes a JSON object
// and sometimes a JSON-encoded string of that object (double-encoded). Decode
// once, and if the result is still a string, decode again.
function decodeWpJson<T = unknown>(raw: string): T {
  const first = JSON.parse(raw) as unknown;
  if (typeof first === "string") return JSON.parse(first) as T;
  return first as T;
}

async function fetchListPage(page: number): Promise<SfCompanyListItem[]> {
  const { data } = await axios.get<SfCompanyListItem[]>(LIST_URL, {
    params: { per_page: PER_PAGE, page, _fields: "id,slug,title,link" },
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  return data;
}

async function fetchAllEntries(): Promise<PortfolioEntry[]> {
  const out: PortfolioEntry[] = [];
  let page = 1;
  while (true) {
    let items: SfCompanyListItem[];
    try {
      items = await fetchListPage(page);
    } catch (err: any) {
      // WP returns 400 with rest_post_invalid_page_number when paging past
      // the last page; treat as end-of-list.
      if (err?.response?.status === 400) break;
      throw err;
    }
    if (items.length === 0) break;
    for (const it of items) {
      const name = cheerio.load(`<x>${it.title.rendered}</x>`)("x").text().trim();
      if (!name || !it.slug) continue;
      out.push({ id: it.id, slug: it.slug, name });
    }
    console.log(`[Insight] list page ${page}: +${items.length} (total ${out.length})`);
    if (items.length < PER_PAGE) break;
    page++;
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }
  return out;
}

interface DetailRecord {
  status: string | null;
  website: string | null;
}

async function fetchDetail(id: number): Promise<DetailRecord> {
  const { data: raw } = await axios.get<string>(CONTENT_URL, {
    params: { id },
    headers: { "User-Agent": UA },
    // Force text — axios would otherwise auto-parse the outer JSON layer and
    // hide the double-encoding from us.
    responseType: "text",
    transformResponse: [(d) => d],
    timeout: 20_000,
  });
  const decoded = decodeWpJson<{ content?: string }>(raw);
  const html = decoded.content ?? "";
  if (!html) return { status: null, website: null };

  const $ = cheerio.load(html);

  // Status: <span class="font-semibold block">Status</span><span class="block">Current Investment</span>
  let status: string | null = null;
  $("span.font-semibold").each((_, el) => {
    if (status) return;
    if ($(el).text().trim() === "Status") {
      const sibling = $(el).nextAll("span").first().text().trim();
      if (sibling) status = sibling;
    }
  });

  // Website: anchor whose direct SVG child has class `svg-icon__new-window`.
  // All other links in that block (twitter/linkedin/etc.) use different
  // glyphs, so the SVG class is the only reliable discriminator — the
  // anchor's title attribute is reused as "Learn More About <Name>" for
  // every social link on the page.
  let website: string | null = null;
  $("a").each((_, el) => {
    if (website) return;
    if ($(el).find("svg.svg-icon__new-window").length > 0) {
      const href = $(el).attr("href")?.trim();
      if (href && /^https?:\/\//i.test(href)) website = href;
    }
  });

  return { status, website };
}

function isExitStatus(status: string | null): boolean {
  if (!status) return false;
  return /prior\s+investment/i.test(status);
}

export const insightAdapter: IngestorAdapter = {
  name: "Insight",
  source: "insight",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const entries = await fetchAllEntries();
    console.log(`[Insight] ${entries.length} portfolio entries from REST list`);

    const out: CompanyRecord[] = [];
    let skippedExit = 0;
    let missingWebsite = 0;
    let missingStatus = 0;
    let failed = 0;
    let processed = 0;
    const inFlight = new Set<Promise<void>>();

    const launch = (e: PortfolioEntry) => {
      const p = (async () => {
        try {
          const { status, website } = await fetchDetail(e.id);
          if (isExitStatus(status)) {
            skippedExit++;
          } else if (!status) {
            // No status field rendered — treat as data anomaly, skip
            // conservatively rather than ingest an unknown-state row.
            missingStatus++;
          } else if (!website) {
            missingWebsite++;
          } else {
            out.push({
              name: e.name,
              website,
              sourceId: e.slug,
              investors: ["insight"],
              signals: ["vc-backed"],
              isVerified: true,
            });
          }
        } catch (err: any) {
          failed++;
          console.warn(`[Insight] detail fetch failed for ${e.slug} (id=${e.id}): ${err.message}`);
        } finally {
          processed++;
          if (processed % 50 === 0 || processed === entries.length) {
            console.log(
              `[Insight] details: ${processed}/${entries.length} done, ${out.length} kept, ` +
                `${skippedExit} exits, ${missingStatus} no-status, ${missingWebsite} no-website, ${failed} failed`
            );
          }
        }
      })().finally(() => {
        inFlight.delete(p);
      });
      inFlight.add(p);
    };

    for (const entry of entries) {
      while (inFlight.size >= DETAIL_CONCURRENCY) {
        await Promise.race(inFlight);
      }
      launch(entry);
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
    await Promise.all(inFlight);

    console.log(
      `[Insight] fetchAndParse DONE: ${out.length} kept of ${entries.length} entries — ` +
        `${skippedExit} exits, ${missingStatus} no-status, ${missingWebsite} no-website, ${failed} failed`
    );
    return out;
  },
};

export async function ingestInsight(): Promise<void> {
  await runIngestor(insightAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestInsight().finally(() => prisma.$disconnect()).catch(console.error);
}
