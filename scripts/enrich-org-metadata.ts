import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { mergeTags, tagFromTopic } from "./_lib/tags.js";
import { industryFromCodes } from "./_lib/sic-mapping.js";
import { searchOrganization, checkApiHealth } from "../server/lib/apollo.js";

// Free Apollo enrichment for company industry. Calls /mixed_companies/search
// per company, reads the returned sic_codes / naics_codes, and translates
// the first recognized code into our internal industry vocabulary via the
// SIC/NAICS lookup in scripts/_lib/sic-mapping.ts.
//
// Apollo's search endpoints don't consume reveal credits — see apollo.ts:18.
// (Headcount enrichment is intentionally not included: the field was retired
//  from the audience filter; funding stage carries the same signal.)
//
// Usage:
//   npx tsx scripts/enrich-org-metadata.ts                # full run
//   npx tsx scripts/enrich-org-metadata.ts --limit 50     # cap companies
//   npx tsx scripts/enrich-org-metadata.ts --source yc    # filter by source
//   npx tsx scripts/enrich-org-metadata.ts --dry-run      # log without writing
//
// Idempotent. Re-running only touches rows that are still missing industry
// AND for which Apollo returned a recognizable SIC/NAICS code.

function parseFlag(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}
function parseInt10(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

interface Stats {
  scanned: number;
  apolloHits: number;
  apolloMisses: number;
  industryFilled: number;
  codeMissed: number;
  tagsAdded: number;
  errors: number;
}

export async function enrichOrgMetadata(): Promise<void> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    console.error("APOLLO_API_KEY is required in environment (e.g. .env).");
    throw new Error("APOLLO_API_KEY is required");
  }

  const limit = parseInt10(parseFlag("--limit"));
  const source = parseFlag("--source");
  const dryRun = hasFlag("--dry-run");

  if (!(await checkApiHealth(apiKey))) {
    console.error("Apollo API health check failed. Aborting.");
    await prisma.$disconnect();
    return;
  }

  // Only enrich verified rows that are missing industry. Verified gates out
  // unresolved placeholders; the industry filter narrows to actual gaps.
  let companies = await prisma.company.findMany({
    where: {
      isVerified: true,
      industry: null,
      ...(source ? { source } : {}),
    },
    select: { id: true, name: true, domain: true, tags: true },
    orderBy: { createdAt: "asc" },
  });
  if (limit !== null) companies = companies.slice(0, limit);

  console.log(
    `Found ${companies.length} verified companies missing industry${source ? ` (source=${source})` : ""}.${dryRun ? " (dry-run)" : ""}`
  );

  const stats: Stats = {
    scanned: 0, apolloHits: 0, apolloMisses: 0,
    industryFilled: 0, codeMissed: 0, tagsAdded: 0, errors: 0,
  };

  for (const company of companies) {
    stats.scanned++;
    try {
      const org = await searchOrganization(company.name, apiKey);
      if (!org) {
        stats.apolloMisses++;
        await sleep(800);
        continue;
      }
      stats.apolloHits++;

      const newIndustry = industryFromCodes({
        sic: org.sic_codes,
        naics: org.naics_codes,
      });
      if (!newIndustry) {
        stats.codeMissed++;
        // Set SIC_DEBUG=1 to log the unrecognized codes — useful when
        // expanding the SIC/NAICS map after a fresh data ingest.
        if (process.env.SIC_DEBUG) {
          console.log(`  [miss] ${company.name}: sic=${(org.sic_codes ?? []).join(",")} naics=${(org.naics_codes ?? []).join(",")}`);
        }
        await sleep(800);
        continue;
      }

      // Industry tag flows from the same vocabulary, so adding it keeps
      // tags + industry in sync. Skip if the company already carries the
      // resolved tag (idempotent re-runs).
      const tag = tagFromTopic(newIndustry);
      const additions: string[] = [];
      if (tag && !company.tags.includes(tag)) additions.push(tag);

      const update: Record<string, unknown> = { industry: newIndustry };
      if (additions.length > 0) {
        update.tags = mergeTags(company.tags, additions);
        stats.tagsAdded += additions.length;
      }
      stats.industryFilled++;

      const codeShown = (org.naics_codes?.[0] ?? org.sic_codes?.[0]) ?? "?";
      console.log(`  ${company.name}: industry=${newIndustry} (code ${codeShown})${additions.length > 0 ? ` +${additions.join(",")}` : ""}`);

      if (!dryRun) {
        await prisma.company.update({ where: { id: company.id }, data: update });
      }
    } catch (err) {
      stats.errors++;
      console.error(`  ${company.name}: error — ${err instanceof Error ? err.message : err}`);
    }
    // Apollo's free tier rate limits around 1 req/s. The lib already retries
    // on 429 with a 60s wait, but spacing out helps avoid hitting it.
    await sleep(800);
  }

  console.log("\n--- Run summary ---");
  console.log(`Scanned:           ${stats.scanned}`);
  console.log(`Apollo hits:       ${stats.apolloHits}`);
  console.log(`Apollo misses:     ${stats.apolloMisses}`);
  console.log(`Code unrecognized: ${stats.codeMissed}`);
  console.log(`Industry filled:   ${stats.industryFilled}`);
  console.log(`Tag additions:     ${stats.tagsAdded}`);
  console.log(`Errors:            ${stats.errors}`);
  if (dryRun) console.log("(dry-run — no DB writes)");
  await prisma.$disconnect();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  enrichOrgMetadata().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
