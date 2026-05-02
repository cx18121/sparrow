import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { upsertContact } from "./_lib/upsert.js";
import {
  searchContacts,
  revealPerson,
  checkApiHealth,
} from "../server/lib/apollo.js";

// Paid Apollo enrichment. For each company, runs a search (free) then calls
// /people/match (one credit per call) to reveal email + full name and upsert
// the contact. --max-reveals caps total credit burn across the run.

function parseFlag(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function parseInt10(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

interface RunOptions {
  apiKey: string;
  maxReveals: number;
  companyLimit: number | null;
  testDomain: string | null;
}

interface RevealStats {
  searched: number;
  revealAttempts: number;
  emailsRevealed: number;
  upserted: number;
}

async function processDomain(
  domain: string,
  companyId: string | null,
  options: RunOptions,
  stats: RevealStats
): Promise<void> {
  const remaining = options.maxReveals - stats.revealAttempts;
  if (remaining <= 0) return;

  const previews = await searchContacts(domain, options.apiKey);
  stats.searched += previews.length;
  if (previews.length === 0) {
    console.log(`  ${domain}: 0 matches`);
    return;
  }

  const eligible = previews.filter((p) => p.has_email).slice(0, remaining);
  console.log(
    `  ${domain}: ${previews.length} matches, attempting ${eligible.length} reveals`
  );

  for (const preview of eligible) {
    stats.revealAttempts++;
    const person = await revealPerson(preview.id, options.apiKey);
    if (!person?.email) continue;
    stats.emailsRevealed++;

    if (companyId) {
      const upserted = await upsertContact({
        companyId,
        email: person.email,
        name: person.name,
        title: person.title,
        linkedinUrl: person.linkedin_url,
        source: "apollo",
      });
      if (upserted) stats.upserted++;
    }

    console.log(
      `    + ${person.name} <${person.email}> [${person.email_status ?? "unknown"}]`
    );
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function enrichApolloEmails(): Promise<void> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    console.error("APOLLO_API_KEY is required in environment (e.g. .env.local).");
    throw new Error("APOLLO_API_KEY is required");
  }

  const maxReveals = parseInt10(parseFlag("--max-reveals"));
  if (maxReveals === null || maxReveals <= 0) {
    console.error(
      "--max-reveals N is required (cap on Apollo reveal credits to spend this run)."
    );
    throw new Error("--max-reveals is required");
  }

  const options: RunOptions = {
    apiKey,
    maxReveals,
    companyLimit: parseInt10(parseFlag("--limit")),
    testDomain: parseFlag("--test-domain"),
  };

  const healthy = await checkApiHealth(apiKey);
  if (!healthy) {
    console.error("Apollo API health check failed. Aborting.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Reveal cap for this run: ${options.maxReveals} credits.`);
  const stats: RevealStats = {
    searched: 0,
    revealAttempts: 0,
    emailsRevealed: 0,
    upserted: 0,
  };

  if (options.testDomain) {
    console.log(
      `Test mode: revealing for "${options.testDomain}" (no DB writes — companyId unknown).`
    );
    await processDomain(options.testDomain, null, options, stats);
  } else {
    let companies = await prisma.company.findMany({
      where: { source: "yc" },
      select: { id: true, domain: true, name: true },
    });
    if (options.companyLimit !== null) {
      companies = companies.slice(0, options.companyLimit);
      console.log(`Limiting to ${options.companyLimit} companies.`);
    }
    console.log(`Processing ${companies.length} companies.`);

    for (const company of companies) {
      await processDomain(company.domain, company.id, options, stats);
      if (stats.revealAttempts >= options.maxReveals) {
        console.log("Reveal cap reached, stopping.");
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log("\n--- Run summary ---");
  console.log(`People previewed:    ${stats.searched}`);
  console.log(`Reveal calls made:   ${stats.revealAttempts} (cap ${options.maxReveals})`);
  console.log(`Emails revealed:     ${stats.emailsRevealed}`);
  console.log(`Contacts upserted:   ${stats.upserted}`);
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  enrichApolloEmails().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
