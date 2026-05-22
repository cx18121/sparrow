import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// 500 Global (500 Startups) portfolio at https://500.co/companies.
//
// Single API call: /api/startups returns the full set (~2,200 startups)
// in one JSON payload (~2.4MB). Each entry has businessName / companyUrl
// / stage / country / batch (e.g., "GA 34" — global accelerator cohort).
//
// 2163 of 2231 have a companyUrl; we drop the 68 with null URL.

const API_URL = "https://500.co/api/startups";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function normalizeUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  // 500's `companyUrl` field is sometimes "example.com", sometimes
  // "www.example.com", sometimes "https://example.com". Normalize to
  // a canonical https URL — extractDomain in the runner expects a valid URL.
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.toString();
  } catch {
    return null;
  }
}

function normalizeStage(s: string | null): string | null {
  if (!s) return null;
  // 500's vocab: Pre-Seed, Seed, Series A, Series B, Series C, Series C+
  return s.trim();
}

interface Org {
  name?: string;
  businessName?: string;
  alternativeName?: string;
  companyUrl?: string | null;
  countryOfOperation?: { name?: string } | null;
  regionOfOperation?: { name?: string } | null;
}
interface Item {
  oneLiner?: string | null;
  organization?: Org;
  businessModel?: string | null;
  stage?: { name?: string } | null;
  industries?: Array<{ name?: string }>;
  batches?: Array<{ brandName?: string }>;
}

export const fiveHundredAdapter: IngestorAdapter = {
  name: "500Global",
  source: "500global",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[500Global] GET ${API_URL}`);
    const { data } = await axios.get<{ res: Item[] }>(API_URL, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      timeout: 60_000,
    });
    const items = data.res ?? [];
    console.log(`[500Global] API returned ${items.length} startups`);

    const out: CompanyRecord[] = [];
    let noUrl = 0;
    let noName = 0;
    const seenDomain = new Set<string>();

    for (const it of items) {
      const org = it.organization ?? {};
      const rawUrl = (org.companyUrl ?? "").trim();
      if (!rawUrl) { noUrl++; continue; }
      const website = normalizeUrl(rawUrl);
      if (!website) { noUrl++; continue; }

      let domain: string;
      try { domain = new URL(website).hostname.replace(/^www\./, ""); }
      catch { noUrl++; continue; }
      if (seenDomain.has(domain)) continue;
      seenDomain.add(domain);

      const name = (org.businessName || org.name || org.alternativeName || "").trim();
      if (!name || name.length < 2) { noName++; continue; }

      const country = org.countryOfOperation?.name?.trim() || null;
      const stage = normalizeStage(it.stage?.name?.trim() ?? null);
      const batch = it.batches?.[0]?.brandName?.trim() ?? null;
      // industries can be empty array; use first
      const industry = it.industries?.[0]?.name?.trim() ?? null;

      out.push({
        name,
        website,
        oneLiner: it.oneLiner?.trim() || null,
        stage,
        industry,
        // location: country name is good enough for the location field; the
        // wizard's region mapping infers US / EU / International from it.
        location: country,
        batch,
        investors: ["500global"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }

    console.log(`[500Global] fetchAndParse DONE: ${out.length} kept — ${noUrl} no-url, ${noName} no-name`);
    return out;
  },
};

export async function ingest500Global(): Promise<void> {
  await runIngestor(fiveHundredAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingest500Global().finally(() => prisma.$disconnect()).catch(console.error);
}
