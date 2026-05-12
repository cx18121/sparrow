import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Craft Ventures portfolio at https://www.craftventures.com/portfolio.
// Webflow + Finsweet CMS Filter. The list page exposes the richest
// per-card metadata of any source surveyed so far — name, industry, stage,
// unicorn flag, exit flag, and lead-investor — all stored as
// `fs-cmsfilter-field="name|industry|stage|unicorn|exit|investor"`
// attributes on hidden child elements of each card.
//
// **First source with stage data on the list page.** Craft labels each
// company with a Webflow CMS dropdown: Seed, Series A, Series B, Growth,
// etc. Mapped to Sparrow's canonical buckets via mapStage() below.
//
// Per-card markup (one `<a class="portfolio-card-link"... href="/portfolio/<slug>">`):
//
//   <div class="card-content">
//     <img class="portfolio-card-image" ... />
//     ...
//     <div fs-cmsfilter-field="name">Addepar</div>
//     <div fs-cmsfilter-field="industry">Enterprise</div>
//     <div fs-cmsfilter-field="stage">Growth</div>
//     <div fs-cmsfilter-field="investor">David Sacks</div>
//     <div fs-cmsfilter-field="unicorn">Unicorn</div>   ← present iff unicorn
//     <div fs-cmsfilter-field="exit">Exit</div>         ← present iff exited
//   </div>
//
// Exit filter: a non-empty `exit` field on the card → skip (~25% of roster
// per the survey probe). Authoritative source-side discriminator.
//
// Detail-page hop is required for the website — list cards only carry the
// internal `/portfolio/<slug>` anchor. Per detail page, the first non-chrome
// external href is the company URL. Chrome blocklist includes Craft's blog
// surfaces (medium.com/craft-ventures, sacks.substack.com).

const LIST_URL = "https://www.craftventures.com/portfolio";
const DETAIL_BASE = "https://www.craftventures.com";
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CHROME_HOST_PATTERNS: RegExp[] = [
  /\bcraftventures\.com$/i,
  /\bmedium\.com$/i,
  /\bsubstack\.com$/i,
  /\bgmpg\.org$/i,
  /\bfonts\.(googleapis|gstatic)\.com$/i,
  /\bgoogletagmanager\.com$/i,
  /\bcookielaw\.org$/i,
  /\bcdn\./i,
  /\bcloudfront\.net$/i,
  /\bjsdelivr\.net$/i,
  /\bvimeo\.com$/i,
  /\bwebsite-files\.com$/i,
  /\b(twitter|x|linkedin|facebook|youtube|instagram|tiktok)\.com$/i,
];

function isChromeHost(host: string): boolean {
  return CHROME_HOST_PATTERNS.some((p) => p.test(host));
}

// Stage normalization to Sparrow canonical buckets. Craft uses Webflow CMS
// dropdown values — these are the ones observed in the live HTML.
function mapStage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "seed" || s === "pre-seed") return "Seed";
  if (s === "series a" || s === "a") return "Series A";
  if (s === "series b" || s === "b") return "Series B";
  if (s === "series c" || s === "c") return "Series C+";
  if (s === "series d" || s === "d") return "Series C+";
  if (s === "growth" || s === "late") return "Series C+";
  return null;
}

interface ListItem {
  slug: string;
  name: string;
  industry: string | null;
  stage: string | null;
  unicorn: boolean;
}

async function fetchList(): Promise<{ items: ListItem[]; exited: number }> {
  console.log(`[Craft] GET ${LIST_URL}`);
  const { data: html } = await axios.get<string>(LIST_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
    maxRedirects: 5,
  });
  const $ = cheerio.load(html);

  const items: ListItem[] = [];
  let exited = 0;
  const seen = new Set<string>();

  // The cards live inside `<div class="portfolio_collection ...">`. Each card
  // is a `<div role="listitem" class="... w-dyn-item">`. Iterating cards keeps
  // the field reads scoped per company.
  $("div.w-dyn-item").each((_, el) => {
    const $card = $(el);
    const name = $card.find('[fs-cmsfilter-field="name"]').first().text().trim();
    if (!name) return; // skip empty filler items
    const exit = $card.find('[fs-cmsfilter-field="exit"]').first().text().trim();
    if (exit) { exited++; return; }

    const href = $card.find("a[href^='/portfolio/']").first().attr("href") ?? "";
    const slug = href.replace(/^\/+portfolio\/+/, "").replace(/\/$/, "");
    if (!slug) return;
    if (seen.has(slug)) return;
    seen.add(slug);

    const industry =
      $card.find('[fs-cmsfilter-field="industry"]').first().text().trim() || null;
    const stage =
      $card.find('[fs-cmsfilter-field="stage"]').first().text().trim() || null;
    const unicorn =
      $card.find('[fs-cmsfilter-field="unicorn"]').first().text().trim().length > 0;

    items.push({ slug, name, industry, stage, unicorn });
  });
  return { items, exited };
}

async function fetchDetailWebsite(slug: string): Promise<string | null> {
  const url = `${DETAIL_BASE}/portfolio/${slug}`;
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    let website: string | null = null;
    $("a[href^='http']").each((_, el) => {
      if (website) return;
      const href = $(el).attr("href")?.trim();
      if (!href) return;
      let host = "";
      try {
        host = new URL(href).hostname.toLowerCase();
      } catch {
        return;
      }
      if (!host || isChromeHost(host)) return;
      website = href;
    });
    return website;
  } catch (err: any) {
    if (err?.response?.status !== 404) {
      console.warn(`[Craft] detail fetch failed for ${slug}: ${err.message}`);
    }
    return null;
  }
}

export const craftAdapter: IngestorAdapter = {
  name: "Craft",
  source: "craft",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { items, exited } = await fetchList();
    console.log(`[Craft] ${items.length} active + ${exited} exited from list`);

    const out: CompanyRecord[] = [];
    let missingWebsite = 0;
    let processed = 0;
    const inFlight = new Set<Promise<void>>();

    const launch = (it: ListItem) => {
      const p = (async () => {
        const website = await fetchDetailWebsite(it.slug);
        if (!website) {
          missingWebsite++;
        } else {
          const signals = ["vc-backed"];
          if (it.unicorn) signals.push("unicorn");
          out.push({
            name: it.name,
            website,
            stage: mapStage(it.stage),
            industry: it.industry,
            sourceId: it.slug,
            investors: ["craft"],
            signals,
            isVerified: true,
          });
        }
        processed++;
        if (processed % 25 === 0 || processed === items.length) {
          console.log(
            `[Craft] details: ${processed}/${items.length} done, ${out.length} kept, ${missingWebsite} no-website`
          );
        }
      })().finally(() => {
        inFlight.delete(p);
      });
      inFlight.add(p);
    };

    for (const it of items) {
      while (inFlight.size >= DETAIL_CONCURRENCY) {
        await Promise.race(inFlight);
      }
      launch(it);
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
    await Promise.all(inFlight);

    console.log(
      `[Craft] fetchAndParse DONE: ${out.length} kept, ${exited} exited, ${missingWebsite} no-website`
    );
    return out;
  },
};

export async function ingestCraft(): Promise<void> {
  await runIngestor(craftAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestCraft().finally(() => prisma.$disconnect()).catch(console.error);
}
