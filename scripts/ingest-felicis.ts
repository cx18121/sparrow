import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Felicis Ventures portfolio at https://www.felicis.com/portfolio.
// Next.js + Sanity CMS. The portfolio grid is rendered via streaming Next.js
// RSC chunks delivered through `self.__next_f.push(...)` calls — the full
// company corpus lives inside the page HTML as backslash-escaped JSON
// fragments (208 unique companies in the seed run).
//
// Per-company JSON shape (when escaped in the HTML source):
//
//   ..."excerpt":"Financial technology platform",..."name":"Adyen",
//      ..."status":"ipo","websiteUrl":"https://www.adyen.com/"}
//
// Extraction strategy (no JSON parse required — the streaming format isn't
// canonical JSON):
//   1. Match every `\"websiteUrl\":\"<URL>\"` occurrence in the raw HTML.
//   2. For each match, back-search up to 1500 chars for the nearest
//      preceding `\"name\":\"<NAME>\"` — JSON key order in the upstream Sanity
//      doc places `name` ahead of `websiteUrl`, and founder names sit in a
//      separate referenced chunk (`founders:"$38"`), so the closest name is
//      reliably the company name.
//   3. Also pull the status field via the same back-search. Status values
//      observed: "current" (active), "acquired" (exit), "ipo" (exit).
//   4. Dedupe by URL.
//
// Status filter:
//   "current" → keep
//   "acquired" / "ipo" / anything else → skip
//
// Cross-source dedupe in runIngestor absorbs overlap with sources that mark
// exits differently. No stage data on this surface — `stage` ingests as
// null. The HTML carries `"stage":"$5a"` style references, but resolving
// those would require parsing the streaming chunks; not worth it.

const PORTFOLIO_URL = "https://www.felicis.com/portfolio";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const URL_RE = /\\"websiteUrl\\":\\"(https?:\/\/[^"\\]+)/g;
const NAME_RE = /\\"name\\":\\"([^"\\]{1,100})\\"/g;
const STATUS_RE = /\\"status\\":\\"([^"\\]+)\\"/g;

interface RawCompany {
  url: string;
  name: string | null;
  status: string | null;
}

function lastMatch(re: RegExp, s: string): string | null {
  let m: RegExpExecArray | null;
  let last: string | null = null;
  // Reset state since we're reusing the global RE.
  re.lastIndex = 0;
  while ((m = re.exec(s)) !== null) last = m[1];
  return last;
}

function isExitStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  return s !== "current" && s !== "active" && s !== "private" && s !== "";
}

export const felicisAdapter: IngestorAdapter = {
  name: "Felicis",
  source: "felicis",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Felicis] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 45_000,
      maxRedirects: 5,
    });

    const seen = new Set<string>();
    const records: RawCompany[] = [];
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(html)) !== null) {
      const url = m[1];
      if (seen.has(url)) continue;
      seen.add(url);
      const back = html.slice(Math.max(0, m.index - 1500), m.index);
      const name = lastMatch(NAME_RE, back);
      const status = lastMatch(STATUS_RE, back);
      records.push({ url, name, status });
    }

    const out: CompanyRecord[] = [];
    let skippedExit = 0;
    let missingName = 0;
    for (const r of records) {
      if (isExitStatus(r.status)) { skippedExit++; continue; }
      if (!r.name) { missingName++; continue; }
      out.push({
        name: r.name,
        website: r.url,
        investors: ["felicis"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }

    console.log(
      `[Felicis] fetchAndParse DONE: ${out.length} kept of ${records.length} candidates — ` +
        `${skippedExit} exits, ${missingName} no-name`
    );
    return out;
  },
};

export async function ingestFelicis(): Promise<void> {
  await runIngestor(felicisAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestFelicis().finally(() => prisma.$disconnect()).catch(console.error);
}
