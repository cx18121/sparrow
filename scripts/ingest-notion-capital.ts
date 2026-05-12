import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Notion Capital portfolio at https://www.notioncapital.com/portfolio
// (the `notion.vc/portfolio` URL still redirects there). European B2B SaaS
// firm — not to be confused with the unrelated software company Notion.so.
//
// Webflow CMS; the grid renders all 99 cards inline. The list page exposes
// name + tagline + status, but NOT the company website — the inner anchors
// only point to `/portfolio/<slug>` detail pages, which carry the external
// link. Two-step extraction:
//
//   1. Parse `<div class="company-card-wrapper w-dyn-item">` blocks.
//      - `<h4 class="company-card-heading">`         → name
//      - `<div class="p-small portfolio-teaser">`    → tagline
//      - `<div class="tag-legacy card aquired">VAL</div>` → status field
//        ("Invested" = active, "Exited" = skip)
//      - inner `<a href="/portfolio/<slug>">`        → slug for detail hop
//
//   2. For each active row, GET `/portfolio/<slug>` and extract the first
//      non-chrome external href. Notion's own infrastructure links
//      (included.vc, notionvc.typeform.com, principlesofpricing.com) need
//      to be in the chrome blocklist so they don't win the "first external
//      link" race.
//
// Per the list-page probe: 64 Invested + 35 Exited of 99 cards. Exit filter
// is authoritative (source-side tag), no skiplist needed.
//
// No stage data, so every active row ingests with stage=null — same as
// most other adapters.

const LIST_URL = "https://www.notioncapital.com/portfolio";
const DETAIL_BASE = "https://www.notioncapital.com";
const REQUEST_DELAY_MS = 600;
const DETAIL_CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CHROME_HOST_PATTERNS: RegExp[] = [
  /\bnotioncapital\.com$/i,
  /\bnotion\.vc$/i,
  /\bincluded\.vc$/i,
  /\bnotionvc\.typeform\.com$/i,
  /\bprinciplesofpricing\.com$/i,
  /\btypeform\.com$/i,
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

interface ListItem {
  slug: string;
  name: string;
  tagline: string | null;
}

async function fetchList(): Promise<{ items: ListItem[]; exited: number }> {
  console.log(`[NotionCapital] GET ${LIST_URL}`);
  const { data: html } = await axios.get<string>(LIST_URL, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
    maxRedirects: 5,
  });
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  let exited = 0;

  $("div.company-card-wrapper.w-dyn-item").each((_, el) => {
    const $card = $(el);
    const status = $card.find("div.tag-legacy").first().text().trim();
    if (/exited/i.test(status)) {
      exited++;
      return;
    }
    const name = $card.find("h4.company-card-heading").first().text().trim();
    const tagline = $card.find("div.portfolio-teaser").first().text().trim() || null;
    const href = $card.find("a[href^='/portfolio/']").first().attr("href") ?? "";
    const slug = href.replace(/^\/+portfolio\/+/, "").replace(/\/$/, "");
    if (!name || !slug) return;
    items.push({ slug, name, tagline });
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
      console.warn(`[NotionCapital] detail fetch failed for ${slug}: ${err.message}`);
    }
    return null;
  }
}

export const notionCapitalAdapter: IngestorAdapter = {
  name: "NotionCapital",
  source: "notion-capital",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { items, exited } = await fetchList();
    console.log(`[NotionCapital] ${items.length} active + ${exited} exited from list`);

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
          out.push({
            name: it.name,
            website,
            oneLiner: it.tagline,
            sourceId: it.slug,
            investors: ["notion-capital"],
            signals: ["vc-backed"],
            isVerified: true,
          });
        }
        processed++;
        if (processed % 25 === 0 || processed === items.length) {
          console.log(
            `[NotionCapital] details: ${processed}/${items.length} done, ${out.length} kept, ${missingWebsite} no-website`
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
      `[NotionCapital] fetchAndParse DONE: ${out.length} kept, ${exited} exited, ${missingWebsite} no-website`
    );
    return out;
  },
};

export async function ingestNotionCapital(): Promise<void> {
  await runIngestor(notionCapitalAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestNotionCapital().finally(() => prisma.$disconnect()).catch(console.error);
}
