import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import skiplists from "./_data/skiplists.json" with { type: "json" };

// Institutional Venture Partners portfolio at https://www.ivp.com/portfolio/.
// Two-step scrape: the list page exposes 153 portfolio anchors as
// a.portfolio-grid-item, each linking to /portfolio/<slug>/. The card itself
// is logo-only — name and external website both live on the detail page.
// Detail extraction: <h1> for the company name, the first external href that
// isn't ivp.com / sharesecurely.com / a common social as the website, plus a
// "Founded YYYY | Partnered YYYY [ | IPO YYYY $TICKER ] [ | Acquired ... ]"
// summary line for exit detection.
//
// Exit filter (skip outreach):
//   1. IVP-flagged exits: summary contains "IPO" or an "Acquired" pattern.
//      Harness is the lone false positive — its summary says "Acquired
//      Traceable 2025" meaning *Harness acquired Traceable*, not that
//      Harness was acquired. classifyExit handles this by treating
//      "Acquired <ProperNoun> <year>" as the acquirer pattern.
//   2. Unparseable summary (defensive). Two rows trip this: steelbrick
//      and pure-storage — both happen to be exits anyway.
//   3. PREEXISTING_PUBLICS skiplist (loaded from
//      scripts/_data/skiplists.json). IVP only flags exits that happened
//      during their investment window; companies that were already public
//      when IVP came in (or quietly exited later without a summary update)
//      aren't caught by the IPO line. List is a best-effort curation as of
//      the adapter-writing date and will drift over time — easier to
//      maintain by hand than via a stale heuristic.
//
// IVP exposes no stage data on either the list or detail surface, so every
// surviving row ingests with stage=null.

const PORTFOLIO_URL = "https://www.ivp.com/portfolio/";
const DETAIL_BASE = "https://www.ivp.com/portfolio/";
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Hosts that always belong to IVP's own infrastructure — never the company's
// own URL even when they appear as external anchors on a detail page.
const IVP_HOSTS = new Set(["ivp.com", "sharesecurely.com"]);

// Social hosts that occasionally appear alongside the company URL as
// "follow us" cards. github.com is intentionally NOT here — some IVP
// portfolio companies legitimately use github.com as their company URL,
// and a portfolio company's social presence is the founders' / company's,
// not IVP's chrome.
const SOCIAL_HOSTS = new Set([
  "twitter.com",
  "x.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
]);

// Companies that IVP's summary line does NOT flag as exits but that have
// either IPO'd or been acquired (typically because IVP invested late,
// post-exit or near-exit, or because IVP's per-company page hasn't been
// updated to reflect a more recent exit). Outreach to these is wasted
// effort — they're either in big-co integration mode or trading publicly.
// The list lives in scripts/_data/skiplists.json so a non-engineer can
// update it without touching code; reasons are stored alongside each entry
// for future-audit context. Long-term, Crunchbase open-data enrichment
// should subsume this (see docs/scraping-research.md Part 4).
const PREEXISTING_PUBLICS = new Set(Object.keys(skiplists.ivp.preexistingPublics));

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Decide whether the IVP-supplied summary line indicates an exit. Returns
//   "exit"        — known exit, skip
//   "active"      — no exit markers
//   "unparseable" — no summary found, default to skip (defensive)
//
// The Harness corner case: "Acquired Traceable 2025" reads as "Harness
// acquired Traceable" — i.e., the IVP company is the *acquirer*, not the
// acquired. We detect this by checking whether "Acquired" is followed by a
// proper noun + year (the acquiree pattern) vs by a bare year / "by" / the
// company's own name (the acquired pattern).
function classifyExit(summary: string | null, name: string): "exit" | "active" | "unparseable" {
  if (!summary) return "unparseable";
  if (/\bIPO\b/i.test(summary)) return "exit";
  if (/Acquired\s+by\b/i.test(summary)) return "exit";
  if (name) {
    const ownName = new RegExp(`Acquired\\s+${escapeRegex(name)}\\b`, "i");
    if (ownName.test(summary)) return "exit";
  }
  // Acquired YYYY — the IVP company was acquired in YYYY.
  if (/\bAcquired\s+\d{4}\b/i.test(summary)) return "exit";
  // Acquired <ProperNoun> <year> — the IVP company is the acquirer.
  if (/\bAcquired\s+[A-Z][A-Za-z]+\s+\d{4}/.test(summary)) return "active";
  // Bare "Acquired" with no following context — be conservative and skip.
  if (/\bAcquired\b/.test(summary)) return "exit";
  return "active";
}

function isIvpHost(host: string): boolean {
  return [...IVP_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
}

function isSocialHost(host: string): boolean {
  return [...SOCIAL_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
}

async function fetchSlugs(): Promise<string[]> {
  console.log(`[IVP] GET ${PORTFOLIO_URL}`);
  const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
    maxRedirects: 5,
  });
  const $ = cheerio.load(html);

  const slugs = new Set<string>();
  $("a.portfolio-grid-item").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    try {
      const u = new URL(href, PORTFOLIO_URL);
      const segs = u.pathname.split("/").filter(Boolean);
      // /portfolio/<slug>/ — only accept depth-2 paths under /portfolio/.
      if (segs[0] !== "portfolio" || !segs[1] || segs.length > 2) return;
      slugs.add(segs[1]);
    } catch {
      // skip malformed hrefs
    }
  });
  return [...slugs];
}

interface DetailRecord {
  name: string | null;
  website: string | null;
  summary: string | null;
}

async function fetchDetail(slug: string): Promise<DetailRecord> {
  const url = `${DETAIL_BASE}${slug}/`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    const name = $("h1").first().text().replace(/\s+/g, " ").trim() || null;

    let website: string | null = null;
    $("a[href^='http']").each((_, el) => {
      if (website) return;
      const href = $(el).attr("href") ?? "";
      let host = "";
      try {
        host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        return;
      }
      if (!host || isIvpHost(host) || isSocialHost(host)) return;
      website = href;
    });

    // Pull the "Founded YYYY | Partnered YYYY [ | IPO ... ] [ | Acquired ... ]"
    // line out of the raw HTML. Regex matches Founded + the next 0-4 sibling
    // <br>-separated chunks; flatten <br> to ` | ` for downstream regex use.
    const m = html.match(/Founded[^<]*(?:<br[^>]*>[^<]+){0,4}/i);
    const summary = m
      ? m[0].replace(/<br[^>]*>/gi, " | ").replace(/\s+/g, " ").trim()
      : null;

    return { name, website, summary };
  } catch (err: any) {
    console.warn(`[IVP] detail fetch failed for ${slug}: ${err.message}`);
    return { name: null, website: null, summary: null };
  }
}

export const ivpAdapter: IngestorAdapter = {
  name: "IVP",
  source: "ivp",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const slugs = await fetchSlugs();
    console.log(`[IVP] ${slugs.length} portfolio slugs`);

    // Sliding-window concurrency for detail-page hops. Conservative pacing
    // (concurrency 3, 600ms launch delay) per the lesson from Lightspeed —
    // see docs/scraping-research.md Part 4. ~153 fetches settle around 2 min.
    const out: CompanyRecord[] = [];
    let missingWebsite = 0;
    let missingName = 0;
    let skippedExit = 0;
    let skippedUnparseable = 0;
    let skippedManual = 0;
    let processed = 0;
    const inFlight = new Set<Promise<void>>();

    const launch = (slug: string) => {
      const p = (async () => {
        if (PREEXISTING_PUBLICS.has(slug)) {
          skippedManual++;
          processed++;
          return;
        }
        const { name, website, summary } = await fetchDetail(slug);
        const classification = classifyExit(summary, name ?? "");
        if (classification === "exit") {
          skippedExit++;
        } else if (classification === "unparseable") {
          skippedUnparseable++;
        } else if (!name) {
          missingName++;
        } else if (!website) {
          missingWebsite++;
        } else {
          out.push({
            name,
            website,
            sourceId: slug,
            investors: ["ivp"],
            signals: ["vc-backed"],
            isVerified: true,
          });
        }
        processed++;
        if (processed % 25 === 0 || processed === slugs.length) {
          console.log(
            `[IVP] details: ${processed}/${slugs.length} done, ${out.length} kept, ` +
              `${skippedExit} exits, ${skippedManual} manual, ${skippedUnparseable} unparseable, ` +
              `${missingName} no-name, ${missingWebsite} no-website`
          );
        }
      })().finally(() => {
        inFlight.delete(p);
      });
      inFlight.add(p);
    };

    for (const slug of slugs) {
      while (inFlight.size >= DETAIL_CONCURRENCY) {
        await Promise.race(inFlight);
      }
      launch(slug);
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
    await Promise.all(inFlight);

    console.log(
      `[IVP] fetchAndParse DONE: ${out.length} kept, ${skippedExit} exits, ` +
        `${skippedManual} manual-skip, ${skippedUnparseable} unparseable, ` +
        `${missingName} no-name, ${missingWebsite} no-website`
    );
    return out;
  },
};

export async function ingestIvp(): Promise<void> {
  await runIngestor(ivpAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestIvp().finally(() => prisma.$disconnect()).catch(console.error);
}
