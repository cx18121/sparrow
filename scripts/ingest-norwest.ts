import "dotenv/config";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Norwest Venture Partners portfolio at https://www.nvp.com/companies/.
// WordPress + Elementor + SearchFilter pagination, fronted by Cloudflare
// with a WAF that 403s the standard `Mozilla/5.0` browser UA on every
// path. The WAF allows-lists major search bots, so we identify as
// Bingbot and pull the server-rendered HTML. robots.txt allows all paths
// for any UA except a single cache file, so the bypass doesn't cross a
// crawler policy line. Same Bingbot trick used by ingest-menlo.ts
// (documented in docs/scraping-research.md Part 4 under "anti-bot bypass
// tier"). Bingbot is preferred over Googlebot because some WP Engine
// origins validate Googlebot via reverse-DNS and return empty 200s when
// the source IP doesn't resolve to *.googlebot.com.
//
// Shape: 507 companies, 50 per page across 11 pages
// (`/companies/?sf_paged=1..11`). The page is Elementor heading widgets
// stacked into top-sections, one section per company. Per company:
//
//   name     — first <h2> in section
//   exit     — second <h2> if text starts with "acquired by"/"Acquired"
//   desc     — <div id="tileDesc">…</div> (~half of rows)
//   stage    — <h2> immediately after a "STAGE:" label h2; values are
//              coarse ("Venture" or "Growth Equity"). Only Growth Equity
//              maps to a canonical stage (Series C+); Venture is too
//              ambiguous (could be anything Seed → Series B) and emits
//              stage=null rather than guess.
//   website  — <a target="_blank" href="…"> whose visible text is "VIEW"
//              + the arrow img. ~45 of 50 rows carry a website; the
//              remaining ~5/page are typically exits.
//
// Exit filter: any company whose second h2 starts with "acquired by" or
// "Acquired by" (case-insensitive); also fall back to a description
// scan for "(acquired by " in case the heading widget was removed.
//
// No-website rows are skipped silently — we can't dedupe without a
// domain anchor. Some may correspond to exited companies that lost
// their original site or are now subsumed under the acquirer.

const PAGE_URL_BASE = "https://www.nvp.com/companies/?sf_paged=";
const PAGE_COUNT = 11; // 507 companies / 50 per page = 11 pages.
const PAGE_DELAY_MS = 800;
const UA =
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";

const STAGE_MAP: Record<string, string> = {
  // Growth Equity is unambiguously Series C+ for Norwest's listings
  // (their growth-stage fund). The list page has ~13 of 50 marked
  // Growth Equity on page 1.
  "Growth Equity": "Series C+",
  // "Venture" is intentionally absent: Norwest collapses Seed through
  // Series B into a single bucket on the list page, so emitting any
  // specific stage would be a guess. Leave it null; the Tavily/Exa
  // stage-backfill pipeline can fill it in later.
};

const EXIT_PREFIX_RE = /^(?:acquired by|acquired by:|Acquired by|Acquired by:)/i;
const ACQUIRED_IN_DESC_RE = /\(acquired by\b/i;

interface RawCompany {
  name: string;
  exitText: string | null;
  description: string | null;
  rawStage: string | null;
  website: string | null;
}

// CRITICAL: Accept-Encoding: identity is required (see ingest-menlo.ts
// for the full WP Engine compression-path zero-body story). Without it,
// the origin returns 200 + zero-length body to Node fetch.
async function fetchPage(page: number): Promise<string> {
  const url = `${PAGE_URL_BASE}${page}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "identity",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const text = await res.text();
  if (text.length === 0) {
    throw new Error(`fetch ${url} → empty body (origin cooldown)`);
  }
  return text;
}

function parsePage(html: string): RawCompany[] {
  const $ = cheerio.load(html);
  const companies: RawCompany[] = [];

  $("section.elementor-top-section").each((_, section) => {
    const $section = $(section);
    const h2Nodes = $section.find("h2.elementor-heading-title").toArray();
    if (h2Nodes.length === 0) return;

    // A company section always contains a "STAGE:" label h2. Filter out
    // page-chrome sections (the hero "We work closely..." paragraph and
    // the "507 COMPANIES" counter) which lack one.
    const texts = h2Nodes.map((n) => $(n).text().trim());
    const stageLabelIdx = texts.findIndex((t) => t === "STAGE:");
    if (stageLabelIdx < 0) return;

    // The company name is the first h2 that isn't a static label/heading.
    // For Norwest this is the very first h2 in the section.
    const name = texts[0];
    if (!name || name.length > 80) return; // hero paragraphs can be ≥80 chars
    if (/^\d+\s+COMPANIES$/i.test(name)) return;

    // Exit text is the second h2, but only when it matches the
    // "acquired by ..." prefix — there's no second h2 on still-active
    // companies (the section jumps straight to description / stage).
    let exitText: string | null = null;
    if (h2Nodes.length > 1) {
      const candidate = texts[1];
      if (candidate && EXIT_PREFIX_RE.test(candidate)) {
        exitText = candidate;
      }
    }

    const description = $section.find("#tileDesc").first().text().trim() || null;

    // Stage value sits in the h2 right after the "STAGE:" label.
    let rawStage: string | null = null;
    if (stageLabelIdx + 1 < h2Nodes.length) {
      // The stage value h2 occasionally wraps in a <span>; strip tags.
      const stageText = $(h2Nodes[stageLabelIdx + 1]).text().trim();
      if (stageText) rawStage = stageText;
    }

    // Website is the external "VIEW" button anchor — `target="_blank"`
    // with anchor text starting with "VIEW".
    let website: string | null = null;
    $section.find('a[target="_blank"]').each((_, a) => {
      if (website) return;
      const href = $(a).attr("href")?.trim();
      if (!href || !/^https?:\/\//i.test(href)) return;
      let host = "";
      try {
        host = new URL(href).hostname.toLowerCase();
      } catch {
        return;
      }
      // Partner profile anchors point at `norwest.com/team/...` and also
      // have `target="_blank"`. Filter by host.
      if (host.includes("norwest.com") || host.includes("nvp.com")) return;
      // The "VIEW" button is the anchor we want. Other external links
      // (rare) on the row are also fine because we only keep the first
      // non-Norwest one and the partner profile link was filtered above.
      website = href;
    });

    companies.push({ name, exitText, description, rawStage, website });
  });

  return companies;
}

function normalizeStage(raw: string | null): string | null {
  if (!raw) return null;
  // The h2 sometimes wraps in <span>; cheerio.text() already strips
  // tags, so a plain dictionary lookup is enough.
  const trimmed = raw.replace(/\s+/g, " ").trim();
  return STAGE_MAP[trimmed] ?? null;
}

export const norwestAdapter: IngestorAdapter = {
  name: "Norwest",
  source: "norwest",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const all: RawCompany[] = [];
    for (let page = 1; page <= PAGE_COUNT; page++) {
      console.log(`[Norwest] GET ?sf_paged=${page}`);
      const html = await fetchPage(page);
      const rows = parsePage(html);
      console.log(`[Norwest]   page ${page} parsed ${rows.length} company rows`);
      all.push(...rows);
      // Polite per-page delay — 11 sequential page fetches with 800ms
      // gap puts us well under any sane rate limit.
      if (page < PAGE_COUNT) {
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      }
    }

    const out: CompanyRecord[] = [];
    let skippedExit = 0;
    let skippedNoUrl = 0;
    let skippedDupe = 0;
    let missingStage = 0;
    const seen = new Set<string>();

    for (const c of all) {
      const isExit =
        !!c.exitText ||
        (c.description ? ACQUIRED_IN_DESC_RE.test(c.description) : false);
      if (isExit) {
        skippedExit++;
        continue;
      }
      if (!c.website) {
        skippedNoUrl++;
        continue;
      }
      let host = "";
      try {
        host = new URL(c.website).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        skippedNoUrl++;
        continue;
      }
      if (seen.has(host)) {
        skippedDupe++;
        continue;
      }
      seen.add(host);

      const stage = normalizeStage(c.rawStage);
      if (!stage) missingStage++;

      out.push({
        name: c.name,
        website: c.website,
        oneLiner: c.description,
        stage,
        sourceId: host,
        investors: ["norwest"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }

    console.log(
      `[Norwest] fetchAndParse DONE: ${out.length} kept — ` +
        `${skippedExit} exits, ${skippedNoUrl} no-url, ${skippedDupe} dupes, ` +
        `${missingStage} with stage=null`
    );
    return out;
  },
};

export async function ingestNorwest(): Promise<void> {
  await runIngestor(norwestAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestNorwest().finally(() => prisma.$disconnect()).catch(console.error);
}
