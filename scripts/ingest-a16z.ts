import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// a16z portfolio — 833 companies via window.a16z_portfolio_companies inline JSON.
// Skips public (ticker_symbol set) and acquired companies — not cold email targets.

const BASE_URL = "https://a16z.com/portfolio";

interface A16zCompany {
  title?: string;
  web?: string;
  overview?: string;
  stages?: string[];
  stage?: string;
  ticker_symbol?: string;
  acquirer?: string;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}

function extractJsonArray(html: string, varName: string): any[] | null {
  const prefix = `window.${varName} = `;
  const start = html.indexOf(prefix);
  if (start === -1) return null;
  const arrayStart = html.indexOf("[", start + prefix.length);
  if (arrayStart === -1) return null;

  let depth = 0, inString = false, escape = false;
  let i = arrayStart;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString) {
      if (ch === "[") depth++;
      if (ch === "]") { depth--; if (depth === 0) break; }
    }
  }
  try { return JSON.parse(html.slice(arrayStart, i + 1)); } catch { return null; }
}

function mapStage(stages: string[] | undefined, stage: string | undefined): string | null {
  const all = [...(stages ?? []), stage ?? ""].map(s => s.toLowerCase());
  if (all.includes("growth") || all.includes("late")) return "Series B";
  if (all.includes("early")) return "Seed";
  if (all.includes("seed")) return "Pre-Seed";
  return null;
}

export async function ingestA16z(): Promise<void> {
  let html: string;
  try {
    const { data } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ColdFlowBot/1.0)" },
      timeout: 20_000,
    });
    html = data as string;
  } catch (err: any) {
    console.error(`[a16z] Failed to fetch page: ${err.message}`);
    return;
  }

  const companies = extractJsonArray(html, "a16z_portfolio_companies") as A16zCompany[] | null;
  if (!companies) {
    console.error("[a16z] Could not find window.a16z_portfolio_companies");
    return;
  }
  console.log(`[a16z] ${companies.length} portfolio companies`);

  let ingested = 0, skipped = 0;

  for (const c of companies) {
    if (c.ticker_symbol || c.acquirer) { skipped++; continue; }
    if (!c.web) { skipped++; continue; }

    const domain = extractDomain(c.web);
    if (!domain || isFreeHostingDomain(domain)) { skipped++; continue; }

    const stage = mapStage(c.stages, c.stage);
    const tags = buildTags({ stage, investors: ["a16z"], signals: ["vc-backed"] });
    const qualityScore = computeQualityScore({ isVerified: true, stage });

    try {
      await upsertCompany({
        domain, name: c.title ?? domain, description: c.overview ?? null,
        website: c.web, stage, source: "a16z", sourceId: domain,
        tags, isVerified: true, qualityScore,
      });
      ingested++;
    } catch (err) {
      console.error(`[a16z] Failed "${c.title}": ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[a16z] Ingested ${ingested}, skipped ${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestA16z().finally(() => prisma.$disconnect()).catch(console.error);
}
