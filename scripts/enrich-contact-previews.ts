import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { normalizeRole } from "./_lib/role-normalizer.js";
import { searchContacts, checkApiHealth } from "../server/lib/apollo.js";

// Free Apollo enrichment for contact previews. For each verified company,
// calls /mixed_people/api_search (FREE per apollo.ts:18) and persists each
// returned preview as a Contact row with email=null and source=apollo-preview.
//
// Why persist previews:
//   - Company._count.contacts then reflects what Apollo actually has on file,
//     so the dashboard can surface "5 contacts" without re-querying Apollo.
//   - The "Find contacts" modal can render instantly from the cache instead of
//     waiting on a per-click Apollo round-trip (route fallback is a follow-up).
//   - Users see who exists at a company before deciding whether to spend
//     reveal credits.
//
// Idempotency:
//   The Contact schema doesn't carry an Apollo person id, so the dedup key is
//   (companyId, name, title, source='apollo-preview'). Apollo returns
//   first_name + last_name_obfuscated which is deterministic across runs, so
//   re-running this script doesn't duplicate rows.
//
// Usage:
//   npx tsx scripts/enrich-contact-previews.ts                  # full run
//   npx tsx scripts/enrich-contact-previews.ts --limit 50       # cap companies
//   npx tsx scripts/enrich-contact-previews.ts --source yc      # filter source
//   npx tsx scripts/enrich-contact-previews.ts --dry-run        # log only
//   npx tsx scripts/enrich-contact-previews.ts --skip-with-contacts
//                                                  # only enrich companies
//                                                  # whose contacts list is empty

const PREVIEW_SOURCE = "apollo-preview";

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
  apolloEmpty: number;
  previewsReturned: number;
  previewsInserted: number;
  previewsSkipped: number;
  errors: number;
}

function previewName(p: { first_name: string; last_name_obfuscated: string }): string {
  return `${p.first_name} ${p.last_name_obfuscated}`.trim();
}

export async function enrichContactPreviews(): Promise<void> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    console.error("APOLLO_API_KEY is required in environment (e.g. .env).");
    throw new Error("APOLLO_API_KEY is required");
  }

  const limit = parseInt10(parseFlag("--limit"));
  const source = parseFlag("--source");
  const dryRun = hasFlag("--dry-run");
  const skipWithContacts = hasFlag("--skip-with-contacts");

  if (!(await checkApiHealth(apiKey))) {
    console.error("Apollo API health check failed. Aborting.");
    await prisma.$disconnect();
    return;
  }

  let companies = await prisma.company.findMany({
    where: {
      isVerified: true,
      ...(source ? { source } : {}),
      ...(skipWithContacts ? { contacts: { none: {} } } : {}),
    },
    select: { id: true, name: true, domain: true },
    orderBy: { createdAt: "asc" },
  });
  if (limit !== null) companies = companies.slice(0, limit);

  console.log(
    `Enriching contact previews for ${companies.length} verified companies${source ? ` (source=${source})` : ""}${skipWithContacts ? " (only companies with no contacts)" : ""}.${dryRun ? " (dry-run)" : ""}`
  );

  const stats: Stats = {
    scanned: 0, apolloHits: 0, apolloEmpty: 0,
    previewsReturned: 0, previewsInserted: 0, previewsSkipped: 0, errors: 0,
  };

  for (const company of companies) {
    stats.scanned++;
    try {
      const previews = await searchContacts(company.domain, apiKey);
      if (previews.length === 0) {
        stats.apolloEmpty++;
        await sleep(800);
        continue;
      }
      stats.apolloHits++;
      stats.previewsReturned += previews.length;

      // Pull existing preview rows once per company so the dedup check below
      // is in-memory, not N round trips to Postgres.
      const existing = await prisma.contact.findMany({
        where: { companyId: company.id, source: PREVIEW_SOURCE },
        select: { name: true, title: true },
      });
      const seen = new Set(existing.map(c => `${c.name ?? ""}|${c.title ?? ""}`));

      let inserted = 0;
      let skipped = 0;
      for (const preview of previews) {
        const name = previewName(preview);
        const title = preview.title ?? null;
        const key = `${name}|${title ?? ""}`;
        if (seen.has(key)) {
          skipped++;
          stats.previewsSkipped++;
          continue;
        }
        if (!dryRun) {
          await prisma.contact.create({
            data: {
              companyId: company.id,
              name,
              title,
              role: normalizeRole(title),
              email: null,
              source: PREVIEW_SOURCE,
              lastVerifiedAt: new Date(),
            },
          });
        }
        seen.add(key);
        inserted++;
        stats.previewsInserted++;
      }

      console.log(
        `  ${company.domain}: +${inserted} new preview${inserted === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} already cached)` : ""}`
      );
    } catch (err) {
      stats.errors++;
      console.error(`  ${company.domain}: error — ${err instanceof Error ? err.message : err}`);
    }
    await sleep(800);
  }

  console.log("\n--- Run summary ---");
  console.log(`Companies scanned:    ${stats.scanned}`);
  console.log(`Apollo hits:          ${stats.apolloHits}`);
  console.log(`Apollo empty:         ${stats.apolloEmpty}`);
  console.log(`Previews returned:    ${stats.previewsReturned}`);
  console.log(`Previews inserted:    ${stats.previewsInserted}`);
  console.log(`Previews already cached: ${stats.previewsSkipped}`);
  console.log(`Errors:               ${stats.errors}`);
  if (dryRun) console.log("(dry-run — no DB writes)");
  await prisma.$disconnect();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  enrichContactPreviews().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
