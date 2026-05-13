import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Greylock Partners — companies via var data_portfolio_XXXX inline JSON.
// Website URL lives inside acf.social_networks_portfolio_string HTML.
//
// Stage extraction: each company has a hidden modal in the rendered DOM
// at `<div class="portfolio-modal-box" id="<slug>">` containing
// `<div class="text-box"><p>FIRST PARTNERED <stage></p></div>`. We walk
// every modal-box once to build a slug → stage map, then look up by
// the company's `c.slug` in the existing JSON loop. Greylock emits
// "Series B+" for a few growth-stage rounds — normalized to plain
// "Series B" rather than introducing a one-source-only "+ variant"
// bucket that would fragment audit-stages.

const BASE_URL = "https://greylock.com/portfolio";
const SKIP_LINK_DOMAINS = new Set([
  "twitter.com",
  "x.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "crunchbase.com",
]);

interface GreylockCompany {
  title?: string;
  slug?: string;
  portfolio_status?: string;
  portfolio_domain?: { name?: string };
  acf?: {
    subtitle_portfolio?: string;
    short_description?: string;
    social_networks_portfolio_string?: string;
    hq_portfolio?: string;
  };
}

// Normalize Greylock stage labels to canonical CANONICAL_STAGES form.
// Greylock-specific quirks: "Series B+" exists as a Greylock-only bucket
// for growth-round Series B follow-ons; collapse to "Series B" so the
// audit bucket isn't fragmented by a single source's nomenclature.
// Exported for unit tests.
export function normalizeGreylockStage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^Series [A-F]\+$/.test(t)) return "Series " + t.charAt(7);
  if (/^Series [A-F]$/.test(t)) return t;
  if (/^Pre-?Seed$/i.test(t)) return "Pre-Seed";
  if (/^Seed$/i.test(t)) return "Seed";
  return null;
}

// Build a slug → stage map by walking the rendered portfolio-modal-box
// elements. Each box's `id` attribute is the company slug (matches the
// JSON's c.slug). The text-box inside contains "FIRST PARTNERED <stage>".
// Exported for unit tests.
export function buildGreylockStageMap(html: string): Map<string, string> {
  const $ = cheerio.load(html);
  const out = new Map<string, string>();
  $("div.portfolio-modal-box[id]").each((_, el) => {
    const slug = ($(el).attr("id") ?? "").trim();
    if (!slug) return;
    const text = $(el).find("div.text-box").text().trim();
    const m = text.match(/FIRST\s+PARTNERED\s+(Series [A-F]\+?|Pre-?Seed|Seed)/i);
    if (!m) return;
    const stage = normalizeGreylockStage(m[1]);
    if (stage) out.set(slug, stage);
  });
  return out;
}

function extractWebsite(html: string): string | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  let found: string | null = null;
  $("a[href]").each((_, el) => {
    if (found) return;
    const href = $(el).attr("href") ?? "";
    if (!href.startsWith("http")) return;
    let domain: string;
    try {
      domain = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return;
    }
    if (SKIP_LINK_DOMAINS.has(domain)) return;
    found = href;
  });
  return found;
}

const greylockAdapter: IngestorAdapter = {
  name: "Greylock",
  source: "greylock",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { data: html } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 20_000,
    });

    const match = (html as string).match(/var data_portfolio_\w+\s*=\s*(\[[\s\S]*?\]);\s*\n/);
    if (!match) {
      console.error("[Greylock] Could not find data_portfolio variable");
      return [];
    }

    let companies: GreylockCompany[];
    try {
      companies = JSON.parse(match[1]);
    } catch {
      console.error("[Greylock] Failed to parse portfolio JSON");
      return [];
    }

    const stageMap = buildGreylockStageMap(html as string);

    const out: CompanyRecord[] = [];
    let withStage = 0;
    for (const c of companies) {
      const status =
        typeof c.portfolio_status === "string" ? c.portfolio_status.toLowerCase() : "";
      if (["exited", "acquired", "ipo"].includes(status)) continue;

      const website = extractWebsite(c.acf?.social_networks_portfolio_string ?? "");
      if (!website) continue;

      const industry = c.portfolio_domain?.name ?? null;
      const stage = c.slug ? (stageMap.get(c.slug) ?? null) : null;
      if (stage) withStage++;
      out.push({
        name: c.title ?? "",
        website,
        description: c.acf?.short_description ?? null,
        oneLiner: c.acf?.subtitle_portfolio ?? null,
        stage,
        industry,
        location: c.acf?.hq_portfolio ?? null,
        topics: industry ? [industry] : undefined,
        investors: ["greylock"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    console.log(
      `[Greylock] fetchAndParse DONE: ${out.length} kept, ${withStage} with stage ` +
        `(stage map size: ${stageMap.size})`
    );
    return out;
  },
};

export async function ingestGreylock(): Promise<void> {
  await runIngestor(greylockAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestGreylock().finally(() => prisma.$disconnect()).catch(console.error);
}
