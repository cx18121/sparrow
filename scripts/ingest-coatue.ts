import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Coatue portfolio — Next.js + Contentful CMS. The full company list ships
// inside the SSR'd #__NEXT_DATA__ JSON for both /portfolio and
// /privates-portfolio. The "Load more" button on the page is purely a
// client-side reveal; nothing additional is XHR'd from the CMS, so a single
// HTTP fetch per page captures everything.
//
// Per-company shape: { sys, name, url, type, status, logo, logoWithColor }.
//   - status: "Active" | "Exit" — direct exit filter.
//   - type:   "Growth" | "Venture" — Coatue's investment-fund signal. Maps
//             "Growth" → "Series C+" per the existing convention for
//             late-stage VC adapters (a16z, Accel; see AGENTS.md ingest
//             pipeline section). "Venture" is ambiguous (Coatue's earlier
//             fund spans Pre-Seed to Series B), so it ingests with
//             stage=null rather than misclassify.
//   - url:    company's external website, already direct — no detail-page
//             hop needed.

const PAGES = [
  { label: "portfolio",          url: "https://www.coatue.com/portfolio" },
  { label: "privates-portfolio", url: "https://www.coatue.com/privates-portfolio" },
];
const REQUEST_DELAY_MS = 800;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface CoatueCompany {
  name?: string;
  url?: string | null;
  type?: string | null;
  status?: string | null;
}

function mapStage(type: string | null | undefined): string | null {
  if (!type) return null;
  switch (type.toLowerCase()) {
    case "growth":
      return "Series C+";
    case "venture":
      return null; // too ambiguous — could be Pre-Seed to Series B
    default:
      return null;
  }
}

// Walk the Next.js page state for the largest array of company-shaped
// objects (must have both `name` and `url` keys on the first element).
// Coatue nests these under sectionsCollection > itemsCollection, with the
// exact section index varying between /portfolio (idx 1) and
// /privates-portfolio (idx 2). Searching by shape avoids hardcoding the
// path and survives CMS reordering.
function findCompanyArray(data: unknown): CoatueCompany[] {
  let best: { len: number; items: CoatueCompany[] } = { len: 0, items: [] };
  const visit = (obj: unknown, depth: number): void => {
    if (depth > 12) return;
    if (Array.isArray(obj)) {
      if (obj.length > best.len && typeof obj[0] === "object" && obj[0] !== null) {
        const keys = Object.keys(obj[0]);
        if (keys.includes("name") && keys.includes("url")) {
          best = { len: obj.length, items: obj as CoatueCompany[] };
        }
      }
      for (let i = 0; i < Math.min(obj.length, 3); i++) visit(obj[i], depth + 1);
      return;
    }
    if (obj && typeof obj === "object") {
      for (const v of Object.values(obj as Record<string, unknown>)) visit(v, depth + 1);
    }
  };
  visit(data, 0);
  return best.items;
}

async function fetchPortfolio(label: string, url: string): Promise<CoatueCompany[]> {
  console.log(`[Coatue] GET ${url}`);
  const { data: html } = await axios.get<string>(url, {
    headers: { "User-Agent": UA },
    timeout: 30_000,
    maxRedirects: 5,
  });
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").first().html();
  if (!raw) {
    console.warn(`[Coatue] ${label}: no __NEXT_DATA__ script — skipping`);
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err: any) {
    console.warn(`[Coatue] ${label}: JSON.parse failed — ${err.message}`);
    return [];
  }
  const items = findCompanyArray(data);
  console.log(`[Coatue] ${label}: ${items.length} entries`);
  return items;
}

export const coatueAdapter: IngestorAdapter = {
  name: "Coatue",
  source: "coatue",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const all: CoatueCompany[] = [];
    for (const { label, url } of PAGES) {
      try {
        all.push(...(await fetchPortfolio(label, url)));
      } catch (err: any) {
        console.warn(`[Coatue] ${label} fetch failed: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }

    let skippedExit = 0;
    let skippedNoUrl = 0;
    let skippedNoName = 0;
    const out: CompanyRecord[] = [];
    for (const c of all) {
      const name = c.name?.trim();
      const url = c.url?.trim();
      if (!name) { skippedNoName++; continue; }
      if (!url) { skippedNoUrl++; continue; }
      if (c.status && c.status.toLowerCase() === "exit") {
        skippedExit++;
        continue;
      }
      out.push({
        name,
        website: url,
        stage: mapStage(c.type ?? null),
        investors: ["coatue"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }
    console.log(
      `[Coatue] fetchAndParse DONE: ${out.length} kept of ${all.length} entries — ` +
        `${skippedExit} exits, ${skippedNoUrl} no-url, ${skippedNoName} no-name`
    );
    return out;
  },
};

export async function ingestCoatue(): Promise<void> {
  await runIngestor(coatueAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestCoatue().finally(() => prisma.$disconnect()).catch(console.error);
}
