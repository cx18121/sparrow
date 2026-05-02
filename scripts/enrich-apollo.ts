import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { searchContacts, checkApiHealth } from "../api/_lib/apollo.js";

// Preview-only Apollo enrichment. Apollo's search endpoint returns obfuscated
// previews (no email, masked last name) and does not consume reveal credits.
// Use enrich-apollo-emails.ts to spend credits and persist real contacts.

function parseFlag(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function parseLimit(): number | null {
  const v = parseFlag("--limit");
  if (!v) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function formatPreviewName(p: { first_name: string; last_name_obfuscated: string }): string {
  return `${p.first_name} ${p.last_name_obfuscated}`.trim();
}

export async function enrichApollo(): Promise<void> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    console.error("APOLLO_API_KEY is required in environment (e.g. .env.local).");
    throw new Error("APOLLO_API_KEY is required");
  }

  const healthy = await checkApiHealth(apiKey);
  if (!healthy) {
    console.error("Apollo API health check failed. Aborting.");
    await prisma.$disconnect();
    return;
  }

  const testDomain = parseFlag("--test-domain");
  if (testDomain) {
    console.log(`Preview mode: searching Apollo for "${testDomain}" (no credits, no DB writes).`);
    const results = await searchContacts(testDomain, apiKey);
    console.log(`Apollo returned ${results.length} matching people for ${testDomain}:`);
    for (const p of results) {
      const tag = p.has_email ? "email available" : "no email";
      console.log(`  - ${formatPreviewName(p)} | ${p.title} | ${tag}`);
    }
    console.log("\nTo reveal emails and persist contacts, run: enrich-apollo-emails.ts");
    await prisma.$disconnect();
    return;
  }

  const limit = parseLimit();
  let companies = await prisma.company.findMany({
    where: { source: "yc" },
    select: { id: true, domain: true, name: true },
  });
  if (limit !== null) {
    companies = companies.slice(0, limit);
    console.log(`Limiting preview to ${limit} companies.`);
  }

  console.log(`Previewing Apollo matches for ${companies.length} companies (no DB writes).`);

  let totalPreviewed = 0;
  let withEmail = 0;
  for (const company of companies) {
    const results = await searchContacts(company.domain, apiKey);
    totalPreviewed += results.length;
    withEmail += results.filter((p) => p.has_email).length;
    console.log(`  ${company.domain}: ${results.length} matches (${results.filter((p) => p.has_email).length} with email)`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(
    `\nPreview complete. ${totalPreviewed} people found, ${withEmail} have revealable emails.`
  );
  console.log("To spend credits and persist contacts, run: enrich-apollo-emails.ts");
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  enrichApollo().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
