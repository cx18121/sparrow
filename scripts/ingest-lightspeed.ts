import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Lightspeed Venture Partners portfolio at https://lsvp.com/portfolio/.
// Two-step scrape: the list page exposes 664 founder cards under
// #section-companies (each anchor links to lsvp.com/company/<slug>/) with
// list-view fields Founded / Stage Invested / Backed Since / Status. The
// company's external website only appears on the detail page, wrapped in
// either .banner-logo or .company-logo (two layout variants share the same
// "first href under logo" rule). Stage labels are mostly granular Series
// A..I, with a tail of non-canonical labels (Early, Common, A-1, Seed-1/2)
// folded by normalizeStage. Status of Public / IPO / Acquired indicates an
// exit — skip outreach.

const PORTFOLIO_URL = "https://lsvp.com/portfolio/";
const COMPANY_URL_BASE = "https://lsvp.com/company/";
// First-run pacing (concurrency 5, 300ms delay, SparrowBot UA) hit lsvp.com's
// WAF cumulative quota partway through and lost ~190 detail pages to 503. The
// failure pattern was alphabetical from a mid-run slug — i.e. the throttle
// state was per-session, not per-second. Conservative pacing + a plain
// browser UA reduces the chance of tripping that quota on a re-run.
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Status values that indicate the company has exited. Lightspeed labels
// recently-public companies as `Public`, not `IPO` (Rubrik = Public), so we
// have to skip both. `Acquired` is included for completeness even if we
// haven't observed it in samples.
const EXIT_STATUSES = new Set(["acquired", "ipo", "public"]);

// Lightspeed emits a few non-canonical stage labels alongside the standard
// Seed / Series A..I taxonomy. Folding sub-rounds into their parent series
// keeps wizard chips populated; the genuinely ambiguous labels (Common,
// Ordinary) drop to null rather than misclassify. Mappings come from
// observation of the 500-record dry-run distribution — extend here if a
// later run surfaces another non-canonical label.
function normalizeStage(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  switch (trimmed.toLowerCase()) {
    case "seed-1":
    case "seed-2":
      return "Seed";
    case "a-1":
    case "early":
      return "Series A";
    case "common":
    case "ordinary":
      return null;
    default:
      return trimmed;
  }
}

interface ListEntry {
  slug: string;
  name: string;
  stage: string | null;
  status: string | null;
}

function parseListAnchor($: cheerio.CheerioAPI, $a: cheerio.Cheerio<any>): ListEntry | null {
  const href = $a.attr("href") ?? "";
  let slug = "";
  try {
    const segs = new URL(href).pathname.split("/").filter(Boolean);
    if (segs[0] !== "company" || !segs[1]) return null;
    slug = segs[1];
  } catch {
    return null;
  }

  // Three card layouts:
  //   - Compact (most cards): <h5> holds the company name directly.
  //   - Founder card: <h4> = founder name, <h6> = "Role, CompanyName".
  //   - Spotlight (first card, e.g. Anthropic): <h4> = "Role, CompanyName".
  // Try them in compact-first order, splitting on the last ", " so roles
  // containing commas still resolve correctly.
  const afterLastComma = (s: string): string => {
    const i = s.lastIndexOf(", ");
    return i >= 0 ? s.slice(i + 2).trim() : "";
  };
  const text = (sel: string) =>
    $a.find(sel).first().text().replace(/\s+/g, " ").trim();
  const h5 = text("h5");
  const h6 = text("h6");
  const h4 = text("h4");
  const name = h5 || afterLastComma(h6) || afterLastComma(h4);
  if (!name) return null;

  // ul.company-info-list <li> rows: <strong>Label</strong><span>Value</span>.
  // Labels arrive as "Stage Invested" / "Backed Since" / "Founded" / "Status"
  // (a <br> inside <strong> renders as whitespace once text() collapses).
  let stage: string | null = null;
  let status: string | null = null;
  $a.find("ul.company-info-list li").each((_, li) => {
    const $li = $(li);
    const label = $li.find("strong").text().replace(/\s+/g, " ").trim().toLowerCase();
    const value = $li.find("span").text().replace(/\s+/g, " ").trim();
    if (!value) return;
    if (label.startsWith("stage")) stage = value;
    else if (label.startsWith("status")) status = value;
  });

  return { slug, name, stage: normalizeStage(stage), status };
}

async function fetchCompanyWebsite(slug: string): Promise<string | null> {
  const url = `${COMPANY_URL_BASE}${slug}/`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    const href = $(".banner-logo a, .company-logo a").first().attr("href")?.trim();
    return href || null;
  } catch (err: any) {
    console.warn(`[Lightspeed] detail fetch failed for ${slug}: ${err.message}`);
    return null;
  }
}

export const lightspeedAdapter: IngestorAdapter = {
  name: "Lightspeed",
  source: "lightspeed",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Lightspeed] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    const anchors = $("#section-companies a");
    console.log(`[Lightspeed] ${anchors.length} list-view anchors`);

    const entries: ListEntry[] = [];
    let skippedExit = 0;
    let skippedInvalid = 0;
    anchors.each((_, el) => {
      const entry = parseListAnchor($, $(el));
      if (!entry) {
        skippedInvalid++;
        return;
      }
      if (entry.status && EXIT_STATUSES.has(entry.status.toLowerCase())) {
        skippedExit++;
        return;
      }
      entries.push(entry);
    });
    console.log(
      `[Lightspeed] list parse: ${entries.length} candidates, ${skippedExit} exits, ${skippedInvalid} unparseable`
    );

    // Sliding-window concurrency for detail-page hops. The per-launch delay
    // paces requests during the warm-up; once the window fills, Promise.race
    // becomes the bottleneck. With conservative settings (concurrency 3,
    // 600ms spacing) ~664 fetches run for roughly 6-8 minutes.
    const out: CompanyRecord[] = [];
    let missingWebsite = 0;
    let processed = 0;
    const inFlight = new Set<Promise<void>>();

    const launch = (entry: ListEntry) => {
      const p = (async () => {
        const website = await fetchCompanyWebsite(entry.slug);
        if (!website) {
          missingWebsite++;
        } else {
          out.push({
            name: entry.name,
            website,
            stage: entry.stage,
            sourceId: entry.slug,
            investors: ["lightspeed"],
            signals: ["vc-backed"],
            isVerified: true,
          });
        }
        processed++;
        if (processed % 50 === 0 || processed === entries.length) {
          console.log(
            `[Lightspeed] details: ${processed}/${entries.length} done, ${out.length} kept, ${missingWebsite} no-website`
          );
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
      `[Lightspeed] fetchAndParse DONE: ${out.length} records, ${missingWebsite} missing website`
    );
    return out;
  },
};

export async function ingestLightspeed(): Promise<void> {
  await runIngestor(lightspeedAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestLightspeed().finally(() => prisma.$disconnect()).catch(console.error);
}
