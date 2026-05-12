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
// exits differently.
//
// Stage extraction: Felicis tags ~40 featured companies with a stage via
// `\"stage\":\"$<chunk-id>\"`. Each chunk-id resolves to a stage taxonomy
// chunk shaped `<id>:{...,"title":"Series A"}`. We scan the page once to
// build chunk-id → stage-title, then resolve the back-search hit per
// company. Yields stage for the 4 canonical buckets Felicis exposes:
// Seed / Series A / Series B / Series C. Non-featured rows still ingest
// with stage=null (no JSON stage field on those).

const PORTFOLIO_URL = "https://www.felicis.com/portfolio";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const URL_RE = /\\"websiteUrl\\":\\"(https?:\/\/[^"\\]+)/g;
const NAME_RE = /\\"name\\":\\"([^"\\]{1,100})\\"/g;
const STATUS_RE = /\\"status\\":\\"([^"\\]+)\\"/g;
const STAGE_REF_RE = /\\"stage\\":\\"\$([0-9a-f]+)\\"/g;
// Stage taxonomy chunks live separately, shaped as: `<id>:{...,"title":"Series A"}`.
// The `\\"order\\":\\d+,\\"slug\\":\\"\$[^"]+\\"` clause anchors on stage-chunk
// structure to avoid matching unrelated chunks that also have a title field.
const STAGE_CHUNK_RE = /(?:^|\\n)([0-9a-f]+):\{\\"_id\\":\\"[^"\\]+\\",\\"order\\":\d+,\\"slug\\":\\"\$[^"]+\\",\\"title\\":\\"([^"\\]+)\\"\}/g;

interface RawCompany {
  url: string;
  name: string | null;
  status: string | null;
  stage: string | null;
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

// Normalize Felicis stage titles to canonical form. One chunk in the wild
// has a leading space ("title":" Series C"), which the source-of-truth
// match would otherwise carry into Company.stage and fragment the bucket
// in audit-stages.
function normalizeFelicisStage(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^Series [A-F]\+?$/.test(t)) return t;
  if (/^Pre-?Seed$/i.test(t)) return "Pre-Seed";
  if (/^Seed$/i.test(t)) return "Seed";
  return null;
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

    // First pass: build stage chunk-id -> canonical-stage map.
    const stageMap = new Map<string, string>();
    STAGE_CHUNK_RE.lastIndex = 0;
    let sm: RegExpExecArray | null;
    while ((sm = STAGE_CHUNK_RE.exec(html)) !== null) {
      const canonical = normalizeFelicisStage(sm[2]);
      if (canonical) stageMap.set(sm[1], canonical);
    }

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
      const stageRefId = lastMatch(STAGE_REF_RE, back);
      const stage = stageRefId ? (stageMap.get(stageRefId) ?? null) : null;
      records.push({ url, name, status, stage });
    }

    const out: CompanyRecord[] = [];
    let skippedExit = 0;
    let missingName = 0;
    let withStage = 0;
    for (const r of records) {
      if (isExitStatus(r.status)) { skippedExit++; continue; }
      if (!r.name) { missingName++; continue; }
      if (r.stage) withStage++;
      out.push({
        name: r.name,
        website: r.url,
        stage: r.stage,
        investors: ["felicis"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    }

    console.log(
      `[Felicis] fetchAndParse DONE: ${out.length} kept of ${records.length} candidates — ` +
        `${skippedExit} exits, ${missingName} no-name, ${withStage} with stage ` +
        `(stage map size: ${stageMap.size})`
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
