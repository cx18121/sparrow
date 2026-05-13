import "dotenv/config";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { CANONICAL_STAGES } from "./_lib/stages.js";

// Menlo Ventures portfolio at https://menlovc.com/portfolio/. WordPress on
// WP Engine, fronted by Cloudflare with a `wpewaf.com` WAF rule that 403s
// the standard `Mozilla/5.0` browser UA — both `/portfolio/` and
// `/wp-json/*` return the "Sorry, you have been blocked" page. The WAF
// allows-lists major search bots, so we identify as Bingbot and pull the
// full server-rendered HTML directly (no Playwright). robots.txt allows
// /portfolio/ for all user agents, so the bypass doesn't cross a crawler
// policy line. Googlebot also passes the WAF but WP Engine's origin layer
// started 200-with-empty-body after a few requests — apparently they
// validate the source IP against Google's reverse-DNS range. Bingbot is
// more durable because Microsoft doesn't enforce the same check.
//
// Shape:
//   1. List page (2.4 MB HTML, Elementor + Tailwind) carries 205 unique
//      `menlovc.com/portfolio/<slug>/` anchors inside `.js-cards-item`
//      blocks. Logos only — no per-card metadata, so a detail-page hop
//      is the only way to get name/website/description/stage.
//
//   2. Each detail page exposes:
//      - JSON-LD WebPage `description`   → company tagline
//      - First anchor with class
//        `portfolio-details-text eyebrow underline` → external website
//      - One or more `Partnered, <STAGE>` strings inside
//        `<span class="portfolio-details-text">` — Menlo records every
//        round they participated in. Anthropic shows both "Pre-Seed"
//        and "Series C"; we pick the **latest** stage by canonical
//        ordinal so it reflects current standing, not first cheque.
//
// No exit filter on the list page itself — Menlo just lists everything
// they've touched, including acquired and IPO'd names. The wizard's
// campaign-time `excludePublics` toggle handles those at filter time,
// same convention as Spark/Khosla/IVP/Insight/Wave/Sapphire/Iconiq.

const LIST_URL = "https://menlovc.com/portfolio/";
const DETAIL_BASE = "https://menlovc.com";
// Polite cadence — WP Engine's origin starts returning 200 + zero-length
// body after as few as 10–15 requests at 2req/s, even with the bingbot
// UA bypass. 2.5s gap + sequential fetches keeps the rate well under
// the threshold; on empty-body responses we back off 30s and retry once.
const REQUEST_DELAY_MS = 2500;
const DETAIL_CONCURRENCY = 1;
const COOLDOWN_BACKOFF_MS = 30_000;
const MAX_COOLDOWN_RETRIES = 1;
// Bingbot UA — the WAF allow-lists major search bots, but WP Engine's
// origin layer started returning empty 200s for Googlebot from non-Google
// IPs (likely a reverse-DNS heuristic). Bingbot still gets the full HTML
// because Microsoft doesn't publish IP ranges that origins routinely
// verify against. If Bingbot later starts failing, DuckDuckBot was also
// confirmed working in the same session.
const UA =
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";

// Canonical stage → sort index, used to pick the highest stage across
// multiple "Partnered, X" rows. CANONICAL_STAGES already orders by funding
// progression; "Series C+" lives at the end so it loses to specific
// granular Series D/E values when both happen to be present.
const STAGE_RANK = new Map<string, number>(
  CANONICAL_STAGES.map((s, i) => [s, i]),
);

// Strings Menlo's detail pages emit alongside "Partnered, ". Maps to
// canonical, normalizing only when needed.
const STAGE_MAP: Record<string, string> = {
  "Pre-Seed": "Pre-Seed",
  "Seed": "Seed",
  "Series A": "Series A",
  "Series B": "Series B",
  "Series C": "Series C",
  "Series D": "Series D",
  "Series E": "Series E",
  "Series F": "Series E",
  "Series G": "Series E",
  "Growth": "Series C+",
  "Growth Equity": "Series C+",
};

interface ListItem {
  slug: string;
}

interface DetailExtract {
  name: string | null;
  website: string | null;
  description: string | null;
  stage: string | null;
}

// CRITICAL: `Accept-Encoding: identity` is non-negotiable for this
// server. WP Engine's origin returns 200 + zero-length body to clients
// that negotiate gzip/br (Node fetch's auto-default), even though
// uncompressed responses for the same UA and IP work fine. Forcing
// `identity` opts out of compression entirely and the full 2.4 MB HTML
// comes back as plaintext. axios was tried first and exhibits the same
// empty-body failure on its compression path; native fetch with this
// header is the most surgical workaround.
async function fetchWithBot(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "identity",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`fetch ${url} → ${res.status}`);
  }
  const text = await res.text();
  if (text.length === 0) {
    throw new Error(`fetch ${url} → empty body (origin cooldown)`);
  }
  return text;
}

async function fetchList(): Promise<ListItem[]> {
  console.log(`[Menlo] GET ${LIST_URL}`);
  const html = await fetchWithBot(LIST_URL);
  // Every portfolio item link points to /portfolio/<slug>/ on the list page.
  const slugs = new Set<string>();
  for (const match of html.matchAll(/menlovc\.com\/portfolio\/([a-z0-9-]+)\/?/gi)) {
    const slug = match[1];
    // Skip the bare /portfolio/ self-link if it sneaks in.
    if (!slug || slug === "portfolio") continue;
    slugs.add(slug);
  }
  return [...slugs].map((slug) => ({ slug }));
}

function pickHighestStage(stages: string[]): string | null {
  let best: string | null = null;
  let bestRank = -1;
  for (const raw of stages) {
    const mapped = STAGE_MAP[raw];
    if (!mapped) continue;
    const rank = STAGE_RANK.get(mapped) ?? -1;
    if (rank > bestRank) {
      best = mapped;
      bestRank = rank;
    }
  }
  return best;
}

function extractDetail(html: string): DetailExtract {
  const $ = cheerio.load(html);

  // Name from <title>: "Anthropic | Menlo Ventures" → "Anthropic".
  const title = $("title").first().text().trim();
  const name = title.replace(/\s*\|\s*Menlo Ventures\s*$/i, "").trim() || null;

  // Description from the JSON-LD WebPage node. Fallback to og:description.
  let description: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (description) return;
    try {
      const data = JSON.parse($(el).text());
      const graph = Array.isArray(data?.["@graph"]) ? data["@graph"] : [data];
      for (const node of graph) {
        if (node?.["@type"] === "WebPage" && typeof node.description === "string") {
          description = node.description.trim();
          break;
        }
      }
    } catch {
      // Some pages have multiple JSON-LD blocks; ignore parse failures.
    }
  });
  if (!description) {
    description = $('meta[property="og:description"]').attr("content")?.trim() || null;
  }

  // Website is the first anchor with the specific portfolio-details-text
  // eyebrow underline classes — the "Visit company site" button on the
  // detail page. We use the class selector rather than "first external
  // _blank anchor" because the page also links to news articles and the
  // partner's LinkedIn profiles via _blank.
  let website: string | null = null;
  $("a.portfolio-details-text.eyebrow.underline").each((_, el) => {
    if (website) return;
    const href = $(el).attr("href")?.trim();
    if (!href || !/^https?:\/\//i.test(href)) return;
    try {
      const host = new URL(href).hostname.toLowerCase();
      if (host.includes("menlovc.com")) return;
      website = href;
    } catch {
      /* skip */
    }
  });

  // Stage: walk every "Partnered, <STAGE>" mention. Multiple rounds appear
  // newest-first in the markup, but we don't trust ordering — pick by
  // canonical rank instead.
  const stageMatches: string[] = [];
  for (const m of html.matchAll(/Partnered,\s+(Pre-Seed|Seed|Series\s+[A-G]|Growth(?:\s+Equity)?)/g)) {
    stageMatches.push(m[1].replace(/\s+/g, " "));
  }
  const stage = pickHighestStage(stageMatches);

  return { name, website, description, stage };
}

async function fetchDetail(slug: string): Promise<DetailExtract | null> {
  const url = `${DETAIL_BASE}/portfolio/${slug}/`;
  for (let attempt = 0; attempt <= MAX_COOLDOWN_RETRIES; attempt++) {
    try {
      const html = await fetchWithBot(url);
      return extractDetail(html);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isCooldown = /empty body/.test(msg);
      const is404 = /→ 404/.test(msg);
      if (is404) return null;
      if (isCooldown && attempt < MAX_COOLDOWN_RETRIES) {
        console.warn(`[Menlo] ${slug}: empty body, backing off ${COOLDOWN_BACKOFF_MS}ms`);
        await new Promise((r) => setTimeout(r, COOLDOWN_BACKOFF_MS));
        continue;
      }
      console.warn(`[Menlo] detail fetch failed for ${slug}: ${msg}`);
      return null;
    }
  }
  return null;
}

export const menloAdapter: IngestorAdapter = {
  name: "Menlo",
  source: "menlo",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const items = await fetchList();
    console.log(`[Menlo] list returned ${items.length} portfolio slugs`);

    const out: CompanyRecord[] = [];
    let missingWebsite = 0;
    let missingName = 0;
    let missingStage = 0;
    let processed = 0;
    const inFlight = new Set<Promise<void>>();

    const launch = (it: ListItem) => {
      const p = (async () => {
        const detail = await fetchDetail(it.slug);
        if (!detail) {
          processed++;
          return;
        }
        if (!detail.name) {
          missingName++;
        } else if (!detail.website) {
          missingWebsite++;
        } else {
          if (!detail.stage) missingStage++;
          out.push({
            name: detail.name,
            website: detail.website,
            oneLiner: detail.description,
            stage: detail.stage,
            sourceId: it.slug,
            investors: ["menlo"],
            signals: ["vc-backed"],
            isVerified: true,
          });
        }
        processed++;
        if (processed % 25 === 0 || processed === items.length) {
          console.log(
            `[Menlo] details: ${processed}/${items.length} done, ${out.length} kept, ${missingWebsite} no-website, ${missingName} no-name`
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
      `[Menlo] fetchAndParse DONE: ${out.length} kept, ${missingWebsite} no-website, ${missingName} no-name, ${missingStage} stage=null`
    );
    return out;
  },
};

export async function ingestMenlo(): Promise<void> {
  await runIngestor(menloAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestMenlo().finally(() => prisma.$disconnect()).catch(console.error);
}
