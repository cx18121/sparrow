import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Techstars accelerator portfolio at https://www.techstars.com/portfolio.
//
// The site queries a public Typesense search index (the API key is a
// client-side search-only token embedded in the JS bundle). We hit
// Typesense directly with that token. ~5100 accelerator companies
// across the global Techstars program history (2007-present).
//
// Per-document fields used:
//   company_name, website, brief_description, city, country, worldregion,
//   industry_vertical (array), first_session_year, is_exit, is_1b
//
// Filter out is_exit=true and accept everything else (Techstars
// considers an exit to be acquisition, IPO, or shutdown).

const TYPESENSE_URL = "https://8gbms7c94riane0lp-1.a1.typesense.net";
// Search-only Typesense key from the public www.techstars.com JS bundle —
// read-only access to one public portfolio collection. Not a real secret,
// but moved to env so gitleaks doesn't flag it as a generic-api-key.
// Grab it from window.__TYPESENSE_CONFIG on the Techstars portfolio page.
const TYPESENSE_TOKEN = process.env.TECHSTARS_TYPESENSE_TOKEN ?? "";
if (!TYPESENSE_TOKEN) {
  console.error("TECHSTARS_TYPESENSE_TOKEN env var required.");
  console.error("It's a public search-only key — grab it from the Techstars");
  console.error("portfolio page's client bundle (DevTools → Network).");
  process.exit(1);
}

const PAGE_SIZE = 250;

interface TsDoc {
  company_name?: string;
  website?: string;
  brief_description?: string;
  city?: string;
  country?: string;
  worldregion?: string;
  industry_vertical?: string[];
  first_session_year?: number;
  first_session_year_s?: string;
  is_exit?: boolean;
  is_1b?: boolean;
  program_names?: string[];
}

function normalizeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try { return new URL(s).toString(); } catch { return null; }
}

async function fetchPage(page: number): Promise<{ hits: TsDoc[]; found: number }> {
  const url = `${TYPESENSE_URL}/collections/companies/documents/search`;
  const params = {
    q: "",
    query_by: "company_name",
    filter_by: "is_accelerator_company:=true",
    per_page: PAGE_SIZE,
    page,
  };
  const { data } = await axios.get<{ hits: Array<{ document: TsDoc }>; found: number }>(url, {
    params,
    headers: { "x-typesense-api-key": TYPESENSE_TOKEN },
    timeout: 30_000,
  });
  return { hits: (data.hits ?? []).map((h) => h.document), found: data.found };
}

export const techstarsAdapter: IngestorAdapter = {
  name: "Techstars",
  source: "techstars",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Techstars] Typesense pagination (per_page=${PAGE_SIZE})`);

    const all: TsDoc[] = [];
    let page = 1;
    let totalFound = 0;
    while (true) {
      const { hits, found } = await fetchPage(page);
      totalFound = found;
      if (hits.length === 0) break;
      all.push(...hits);
      console.log(`[Techstars] page ${page} → ${hits.length} hits (cumulative ${all.length}/${found})`);
      if (all.length >= found || hits.length < PAGE_SIZE) break;
      page++;
    }
    console.log(`[Techstars] total fetched: ${all.length} of ${totalFound}`);

    const out: CompanyRecord[] = [];
    let exits = 0;
    let noWebsite = 0;
    let noName = 0;
    const seenDomain = new Set<string>();

    for (const d of all) {
      if (d.is_exit === true) { exits++; continue; }

      const rawName = (d.company_name ?? "").trim();
      if (!rawName) { noName++; continue; }
      // Techstars stores names lowercase; Title Case them.
      const name = rawName
        .split(/\s+/)
        .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
        .join(" ");

      const website = normalizeUrl(d.website);
      if (!website) { noWebsite++; continue; }

      let domain: string;
      try { domain = new URL(website).hostname.replace(/^www\./, ""); }
      catch { noWebsite++; continue; }
      if (seenDomain.has(domain)) continue;
      seenDomain.add(domain);

      const oneLiner = d.brief_description?.trim() || null;
      const city = d.city?.trim() ?? "";
      const country = d.country?.trim() ?? "";
      const location = [city, country].filter(Boolean).join(", ") || null;
      const industry = (d.industry_vertical?.[0] ?? "").trim() || null;
      const batch = d.first_session_year_s?.trim()
        || (typeof d.first_session_year === "number" ? String(d.first_session_year) : null);

      const signals: string[] = ["vc-backed"];
      if (d.is_1b) signals.push("unicorn");

      out.push({
        name,
        website,
        oneLiner,
        industry,
        location,
        batch,
        investors: ["techstars"],
        signals,
        isVerified: true,
      });
    }

    console.log(`[Techstars] fetchAndParse DONE: ${out.length} kept — ${exits} exits, ${noName} no-name, ${noWebsite} no-website`);
    return out;
  },
};

export async function ingestTechstars(): Promise<void> {
  await runIngestor(techstarsAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestTechstars().finally(() => prisma.$disconnect()).catch(console.error);
}
