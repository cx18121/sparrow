import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Redpoint portfolio at https://www.redpoint.com/companies/.
// Gatsby static site. The companies grid is rendered from a Sanity-backed
// content set that Gatsby pre-builds into `page-data.json` — fetching that
// JSON directly skips HTML parsing entirely.
//
// Endpoint: https://www.redpoint.com/page-data/companies/page-data.json
// Shape   : result.data.companies.edges[].node = {
//             title, link, slug.current, investmentDate, stage[],
//             sectors[], _rawExcerpt[]
//           }
//
// Stage taxonomy is closed (4 buckets) and matches our canonical mapping
// cleanly. Sectors are emitted as `topics` so buildTags can normalize them
// into vertical/tech/model namespaces.
//
// The page-data set has 226 companies, 224 of which carry stage (~99%),
// and every row carries at least one sector. No exit filter is necessary
// because Redpoint doesn't surface exits on this dataset — exits get
// hidden in the wizard via the campaign-time `excludePublics` toggle.

const PAGE_DATA_URL =
  "https://www.redpoint.com/page-data/companies/page-data.json";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Redpoint's 4 stage buckets → our canonical stages. The "Series C or
// Later" bucket maps to the legacy aggregation bucket "Series C+" — same
// shape a16z/Accel use when granularity past B is unknown.
const STAGE_MAP: Record<string, string> = {
  "Seed": "Seed",
  "Series A": "Series A",
  "Series B": "Series B",
  "Series C or Later": "Series C+",
};

interface RedpointStage {
  _id: string;
  title: string;
}
interface RedpointSector {
  _id: string;
  title: string;
}
interface RedpointSpan {
  _type: string;
  text?: string;
}
interface RedpointBlock {
  _type: string;
  children?: RedpointSpan[];
}
interface RedpointCompanyNode {
  title: string;
  link?: string | null;
  slug?: { current?: string | null } | null;
  stage?: RedpointStage[] | null;
  sectors?: RedpointSector[] | null;
  _rawExcerpt?: RedpointBlock[] | null;
}
interface RedpointPageData {
  result?: {
    data?: {
      companies?: { edges?: { node: RedpointCompanyNode }[] };
    };
  };
}

// Flatten a Sanity `_rawExcerpt` into plain text — the first block tends
// to be the company tagline ("X is the world's largest ..."), the second
// describes Redpoint's investment ("We first invested in X's seed ..."),
// so the first block alone makes the best oneLiner.
function firstBlockText(blocks: RedpointBlock[] | null | undefined): string | null {
  if (!blocks || blocks.length === 0) return null;
  const first = blocks[0];
  const spans = first.children ?? [];
  const joined = spans
    .map((s) => (typeof s.text === "string" ? s.text : ""))
    .join("")
    .trim();
  return joined.length > 0 ? joined : null;
}

function normalizeStage(stages: RedpointStage[] | null | undefined): string | null {
  if (!stages || stages.length === 0) return null;
  // Redpoint emits one stage per company; defensively pick the latest by
  // canonical order if the source ever ships multiple.
  for (const s of stages) {
    const mapped = STAGE_MAP[s.title];
    if (mapped) return mapped;
  }
  return null;
}

function sectorTopics(sectors: RedpointSector[] | null | undefined): string[] {
  if (!sectors) return [];
  // tags.ts's normalizeTopicName lowercases and strips punctuation, so
  // passing raw titles works. Keeping them raw also lets buildTags pick
  // up new sectors Redpoint adds later without an extra mapping table.
  return sectors.map((s) => s.title).filter(Boolean);
}

export const redpointAdapter: IngestorAdapter = {
  name: "Redpoint",
  source: "redpoint",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Redpoint] GET ${PAGE_DATA_URL}`);
    const { data } = await axios.get<RedpointPageData>(PAGE_DATA_URL, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      timeout: 30_000,
      maxRedirects: 5,
    });

    const edges = data?.result?.data?.companies?.edges ?? [];
    console.log(`[Redpoint] page-data carries ${edges.length} company edges`);

    const out: CompanyRecord[] = [];
    let skippedNoUrl = 0;
    let skippedNoName = 0;
    let skippedDupe = 0;
    let missingStage = 0;
    const seen = new Set<string>();

    for (const { node } of edges) {
      const name = node.title?.trim();
      if (!name) {
        skippedNoName++;
        continue;
      }
      const link = node.link?.trim();
      if (!link || !/^https?:\/\//i.test(link)) {
        skippedNoUrl++;
        continue;
      }

      let host = "";
      try {
        host = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        skippedNoUrl++;
        continue;
      }
      if (seen.has(host)) {
        skippedDupe++;
        continue;
      }
      seen.add(host);

      const stage = normalizeStage(node.stage);
      if (!stage) missingStage++;

      out.push({
        name,
        website: link,
        oneLiner: firstBlockText(node._rawExcerpt),
        stage,
        topics: sectorTopics(node.sectors),
        investors: ["redpoint"],
        signals: ["vc-backed"],
        isVerified: true,
        sourceId: node.slug?.current ?? null,
      });
    }

    console.log(
      `[Redpoint] fetchAndParse DONE: ${out.length} kept — ` +
        `${skippedDupe} dupes, ${skippedNoUrl} no-url, ${skippedNoName} no-name, ` +
        `${missingStage} with stage=null`
    );
    return out;
  },
};

export async function ingestRedpoint(): Promise<void> {
  await runIngestor(redpointAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestRedpoint().finally(() => prisma.$disconnect()).catch(console.error);
}
