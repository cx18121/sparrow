import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { upsertContact } from "./_lib/upsert.js";
import { searchContacts, checkApiHealth } from "./_lib/apollo-client.js";

// Parse optional --limit N argument for capping companies processed (useful for testing).
function parseLimit(): number | null {
  const limitIdx = process.argv.indexOf("--limit");
  if (limitIdx !== -1 && process.argv[limitIdx + 1]) {
    const n = parseInt(process.argv[limitIdx + 1], 10);
    return isNaN(n) ? null : n;
  }
  return null;
}

export async function enrichApollo(): Promise<void> {
  // Accept API key from CLI argument (takes precedence) or environment variable.
  const apiKey = process.argv[2] ?? process.env.APOLLO_API_KEY;
  if (!apiKey) {
    console.error(
      "APOLLO_API_KEY is required. Provide it via env (APOLLO_API_KEY=<key>) or as first CLI argument."
    );
    throw new Error("APOLLO_API_KEY is required");
  }

  const healthy = await checkApiHealth(apiKey);
  if (!healthy) {
    console.error("Apollo API health check failed. Aborting enrichment.");
    await prisma.$disconnect();
    return;
  }

  const limit = parseLimit();
  let companies = await prisma.company.findMany({
    select: { id: true, domain: true, name: true },
  });

  if (limit !== null) {
    companies = companies.slice(0, limit);
    console.log(`Limiting enrichment to ${limit} companies.`);
  }

  console.log(`Enriching contacts for ${companies.length} companies.`);

  let totalContacts = 0;
  for (const company of companies) {
    const results = await searchContacts(company.domain, apiKey);

    for (const person of results) {
      if (!person.email) continue;
      await upsertContact({
        companyId: company.id,
        email: person.email,
        name: person.name,
        title: person.title,
        linkedinUrl: person.linkedin_url,
        source: "apollo",
      });
      totalContacts++;
    }

    console.log(`Enriched ${company.domain}: found ${results.length} contacts`);

    // Respect Apollo rate limits — 1-second delay between companies.
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`Enrichment complete. Total contacts upserted: ${totalContacts}`);
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  enrichApollo().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
