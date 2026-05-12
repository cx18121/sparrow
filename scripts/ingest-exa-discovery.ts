import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";
import { exaSearch, type ExaResult } from "../server/lib/ai/exa-search.js";

// Topical company discovery via Exa's `category=company` filter. Unlike every
// other adapter in the pipeline (which scrapes a specific VC's portfolio
// page), this one surfaces companies by semantic-search topic — independent
// of who funded them. Useful for filling gaps the per-VC adapters can't
// reach (companies funded by firms with no public portfolio, bootstrapped
// growth-stage companies, etc.).
//
// Usage:
//   npx tsx scripts/ingest-exa-discovery.ts \
//     --query "AI infrastructure startup Series B 2024 2025" \
//     --topic ai-infra-b                                      \
//     --limit 50
//
//   --query "..."       Topical search query passed to Exa.       (required)
//   --topic <slug>      Topic tag attached to every record (used as the
//                       per-query discriminator in the wizard; e.g.
//                       `ai-infra-b`, `devtools-b`, `agents-b`).   (required)
//   --limit N           Number of Exa results to request. Caps at 100 per
//                       Exa /search call.                          (default 50)
//
// Exa's `category=company` filter returns one row per canonical company
// homepage with the company name as `title` and a structured page text
// where the first line is `# <Display Name> (<Legal Name>)` followed by
// `<Display Name> is a <LinkedIn-style industry> company.` That gives us
// name/website/industry without any HTML parsing — see _probe-exa-discovery.ts
// for sample results.
//
// Source slug is the fixed string `exa-discovery`. The per-query topic tag
// is what differentiates runs in the DB. Re-running with the same --topic
// is idempotent (runIngestor dedupes by domain); re-running with a different
// --topic re-tags existing companies via last-write-wins on `description`/
// `oneLiner`, which is the desired behavior — newer topical context replaces
// older where they overlap.
//
// Cost: each --limit 50 run uses 1 Exa /search credit. Cheap relative to
// the 800+ HTTP fetches a VC-portfolio adapter does.

interface CliArgs {
  query: string;
  topic: string;
  limit: number;
}

function parseArgs(): CliArgs {
  const argv = process.argv;
  const find = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
  };
  const query = find("--query");
  const topic = find("--topic");
  const limitRaw = find("--limit") ?? "50";
  const limit = Math.max(1, Math.min(100, parseInt(limitRaw, 10) || 50));
  if (!query) throw new Error("--query is required");
  if (!topic) throw new Error("--topic is required");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(topic)) {
    throw new Error(`--topic must be a slug ([a-z0-9-]); got "${topic}"`);
  }
  return { query, topic, limit };
}

// Parse the LinkedIn-style industry line out of Exa's content. The first
// content line is the markdown header `# Display Name (Legal Name)`. The
// second sentence-ish chunk is typically `Display Name is a <Industry>
// company.` — extract the bare industry phrase from there.
const INDUSTRY_RE = /\bis\s+an?\s+([^.\n]{1,80}?)\s+company\b/i;

function parseIndustry(content: string): string | null {
  const m = content.match(INDUSTRY_RE);
  if (!m) return null;
  return m[1].trim();
}

// The first sentence after the markdown header. Used as oneLiner/description.
// Skips lines that are just the header itself.
function parseOneLiner(content: string): string | null {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    // Cut at first sentence end to keep it tight.
    const sentence = (line.split(/(?<=[.!?])\s+/)[0] ?? "").trim();
    if (sentence.length >= 8) return sentence.slice(0, 240);
  }
  return null;
}

function resultToRecord(r: ExaResult, topic: string): CompanyRecord | null {
  const name = r.title.trim();
  const website = r.url.trim();
  if (!name || !website) return null;
  if (!/^https?:\/\//i.test(website)) return null;

  return {
    name,
    website,
    description: r.content?.slice(0, 1200) || null,
    oneLiner: parseOneLiner(r.content ?? ""),
    industry: parseIndustry(r.content ?? ""),
    topics: [topic],
    signals: ["exa-discovery"],
    // Exa's `category=company` filter only returns canonical company pages,
    // and the row already carries a strong primary-source signal. Mark as
    // verified so the wizard surfaces it by default.
    isVerified: true,
  };
}

export function buildAdapter(args: CliArgs): IngestorAdapter {
  return {
    name: `Exa(${args.topic})`,
    source: "exa-discovery",
    async fetchAndParse(): Promise<CompanyRecord[]> {
      const apiKey = process.env.EXA_API_KEY;
      if (!apiKey) throw new Error("EXA_API_KEY is required");

      console.log(`[Exa] query="${args.query}" topic=${args.topic} limit=${args.limit}`);
      const resp = await exaSearch({
        query: args.query,
        apiKey,
        numResults: args.limit,
        type: "auto",
        category: "company",
        textMaxCharacters: 800,
      });
      if (resp.autopromptString) {
        console.log(`[Exa] autoprompt → "${resp.autopromptString}"`);
      }
      console.log(`[Exa] ${resp.results.length} raw results`);

      const out: CompanyRecord[] = [];
      let dropped = 0;
      for (const r of resp.results) {
        const rec = resultToRecord(r, args.topic);
        if (!rec) { dropped++; continue; }
        out.push(rec);
      }
      console.log(`[Exa] fetchAndParse DONE: ${out.length} kept, ${dropped} dropped`);
      return out;
    },
  };
}

export async function ingestExaDiscovery(args: CliArgs): Promise<void> {
  await runIngestor(buildAdapter(args));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args: CliArgs;
  try {
    args = parseArgs();
  } catch (err: any) {
    console.error(err.message);
    console.error(
      'Usage: tsx scripts/ingest-exa-discovery.ts --query "<text>" --topic <slug> [--limit N]'
    );
    process.exit(1);
  }
  ingestExaDiscovery(args).finally(() => prisma.$disconnect()).catch(console.error);
}
