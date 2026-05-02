import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// a16z portfolio — companies via window.a16z_portfolio_companies inline JSON.
// Skips public (ticker_symbol set) and acquired companies.

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

function extractJsonArray(html: string, varName: string): any[] | null {
  const prefix = `window.${varName} = `;
  const start = html.indexOf(prefix);
  if (start === -1) return null;
  const arrayStart = html.indexOf("[", start + prefix.length);
  if (arrayStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let i = arrayStart;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "[") depth++;
      if (ch === "]") {
        depth--;
        if (depth === 0) break;
      }
    }
  }
  try {
    return JSON.parse(html.slice(arrayStart, i + 1));
  } catch {
    return null;
  }
}

function mapStage(stages: string[] | undefined, stage: string | undefined): string | null {
  const all = [...(stages ?? []), stage ?? ""]
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.toLowerCase());
  if (all.includes("growth") || all.includes("late")) return "Series B";
  if (all.includes("early")) return "Seed";
  if (all.includes("seed")) return "Pre-Seed";
  return null;
}

const a16zAdapter: IngestorAdapter = {
  name: "a16z",
  source: "a16z",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { data: html } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 20_000,
    });

    const companies = extractJsonArray(html as string, "a16z_portfolio_companies") as
      | A16zCompany[]
      | null;
    if (!companies) {
      console.error("[a16z] Could not find window.a16z_portfolio_companies");
      return [];
    }

    const out: CompanyRecord[] = [];
    for (const c of companies) {
      if (c.ticker_symbol || c.acquirer) continue;
      if (!c.web || !c.title) continue;
      out.push({
        name: c.title,
        website: c.web,
        description: c.overview ?? null,
        stage: mapStage(c.stages, c.stage),
        investors: ["a16z"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    return out;
  },
};

export async function ingestA16z(): Promise<void> {
  await runIngestor(a16zAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestA16z().finally(() => prisma.$disconnect()).catch(console.error);
}
