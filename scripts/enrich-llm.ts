/**
 * LLM-powered data enrichment for the Company table.
 *
 * Usage:
 *   npx tsx scripts/enrich-llm.ts --regions              # classify unrecognized locations
 *   npx tsx scripts/enrich-llm.ts --industries           # infer industry from name+description
 *   npx tsx scripts/enrich-llm.ts --regions --industries # both
 *   npx tsx scripts/enrich-llm.ts --dry-run --regions    # preview without writing
 *
 * Requires ANTHROPIC_API_KEY in your .env file.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { normalizeRegion } from "./_lib/region-map.js";
import { tagsFromTopics, mergeTags } from "./_lib/tags.js";

const MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";
const BATCH = 50;  // items per LLM call

// ── Known region vocabulary — what the LLM is allowed to return ──────────────
const KNOWN_REGIONS = [
  // US
  "Bay Area", "New York Metro", "Boston / Cambridge", "Austin", "Los Angeles",
  "Chicago", "Seattle", "Pacific Northwest", "Denver / Boulder", "DC Metro",
  "Miami", "Houston", "Dallas", "Atlanta", "Nashville", "Salt Lake City",
  "Raleigh / Durham", "San Diego", "Minneapolis", "Phoenix", "Pittsburgh",
  "Ann Arbor", "Detroit", "Charlotte", "Columbus", "Cincinnati", "Louisville",
  "Memphis", "St. Louis", "Kansas City", "San Antonio", "New Orleans",
  // International
  "London", "Berlin", "Munich", "Hamburg", "Paris", "Amsterdam", "Stockholm",
  "Copenhagen", "Oslo", "Helsinki", "Tel Aviv", "Dubai", "Toronto", "Vancouver",
  "Montreal", "Waterloo", "Bangalore", "Mumbai", "Delhi", "Gurgaon", "Hyderabad",
  "Pune", "Chennai", "Kolkata", "Singapore", "Jakarta", "Ho Chi Minh City",
  "Hanoi", "Tokyo", "Seoul", "Beijing", "Shanghai", "Shenzhen", "Hong Kong",
  "Sydney", "Melbourne", "Brisbane", "São Paulo", "Mexico City", "Bogotá",
  "Buenos Aires", "Santiago", "Lima", "Cairo", "Nairobi", "Lagos", "Accra",
  "Riyadh", "Barcelona", "Madrid", "Lisbon", "Zurich", "Dublin", "Brussels",
  "Warsaw", "Prague", "Vienna", "Budapest", "Tallinn", "Vilnius", "Tbilisi",
  "Istanbul", "Nicosia", "Luxembourg",
  // Special
  "Remote",
];

// ── Claude API helper ─────────────────────────────────────────────────────────

async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in environment");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error ${res.status}: ${text}`);
  }

  const data = await res.json() as any;
  return data.content?.[0]?.text ?? "";
}

// Parses ```json ... ``` fences or bare JSON
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  try { return JSON.parse(raw.trim()); } catch { return null; }
}

// ── Region classification ─────────────────────────────────────────────────────

async function enrichRegions(dryRun: boolean) {
  const companies = await prisma.company.findMany({
    where: { isVerified: true, location: { not: null }, region: null },
    select: { id: true, location: true },
  });

  console.log(`\nRegion classification: ${companies.length} companies to process`);
  if (!companies.length) { console.log("  Nothing to do."); return; }

  let updated = 0;
  let stillNull = 0;

  for (let i = 0; i < companies.length; i += BATCH) {
    const batch = companies.slice(i, i + BATCH);
    const items = batch.map((c, idx) => `${idx}: ${c.location}`).join("\n");

    const prompt = `You are a location classifier. Map each raw location string to a region from the allowed list, or return null if no reasonable match exists.

Allowed regions:
${KNOWN_REGIONS.join(", ")}

Raw location strings (index: value):
${items}

Return ONLY valid JSON — an object mapping each index (as string key) to a region name from the allowed list or null.
Example: {"0": "Bay Area", "1": "London", "2": null}`;

    let result: Record<string, string | null> | null = null;
    try {
      const text = await callClaude(prompt);
      result = extractJson(text) as Record<string, string | null>;
    } catch (err) {
      console.error(`  Batch ${i}-${i + BATCH}: Claude error —`, (err as Error).message);
      continue;
    }

    if (!result) {
      console.error(`  Batch ${i}-${i + BATCH}: could not parse response`);
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const raw = result[String(j)];
      const region = raw && KNOWN_REGIONS.includes(raw) ? raw : null;

      if (region) {
        if (!dryRun) {
          await prisma.company.update({ where: { id: batch[j].id }, data: { region } });
        } else {
          console.log(`  [dry] ${batch[j].location} → ${region}`);
        }
        updated++;
      } else {
        stillNull++;
      }
    }

    process.stdout.write(`  Progress: ${Math.min(i + BATCH, companies.length)}/${companies.length}\r`);
  }

  console.log(`\n  Classified: ${updated}, still unresolvable: ${stillNull}`);
}

// ── Industry inference ────────────────────────────────────────────────────────

// Industry vocab the LLM may return — maps to canonical tag aliases
const INDUSTRY_VOCAB = [
  "fintech", "health", "biotech", "education", "legal", "real estate",
  "govtech", "agriculture", "climate", "energy", "industrial", "logistics",
  "ecommerce", "gaming", "sports", "travel", "food", "fashion", "beauty",
  "pets", "parenting", "automotive", "ai", "crypto", "developer tools",
  "devops", "infrastructure", "security", "data", "analytics", "no-code",
  "api", "mobile", "hardware", "robotics", "iot", "xr", "saas", "b2b",
  "consumer", "marketplace", "marketing", "hr", "productivity", "sales",
  "media", "social", "communications",
];

async function enrichIndustries(dryRun: boolean) {
  const companies = await prisma.company.findMany({
    where: {
      isVerified: true,
      industry: null,
      OR: [{ oneLiner: { not: null } }, { description: { not: null } }],
    },
    select: { id: true, name: true, oneLiner: true, description: true, tags: true },
  });

  console.log(`\nIndustry inference: ${companies.length} companies to process`);
  if (!companies.length) { console.log("  Nothing to do."); return; }

  let updated = 0;
  let skipped = 0;

  // Smaller batch for industry since descriptions are longer
  const INDUSTRY_BATCH = 30;

  for (let i = 0; i < companies.length; i += INDUSTRY_BATCH) {
    const batch = companies.slice(i, i + INDUSTRY_BATCH);
    const items = batch.map((c, idx) => {
      const desc = c.oneLiner ?? c.description?.slice(0, 200) ?? "";
      return `${idx}: [${c.name}] ${desc}`;
    }).join("\n");

    const prompt = `You are an industry classifier for a startup database.

For each company below, return 1-2 industry labels from the allowed vocabulary.
Focus on what the company DOES or SELLS, not who it sells to.

Allowed labels:
${INDUSTRY_VOCAB.join(", ")}

Companies (index: [name] description):
${items}

Return ONLY valid JSON — an object mapping each index (as string key) to an array of 1-2 labels, or null if you cannot determine.
Example: {"0": ["fintech", "saas"], "1": ["biotech"], "2": null}`;

    let result: Record<string, string[] | null> | null = null;
    try {
      const text = await callClaude(prompt);
      result = extractJson(text) as Record<string, string[] | null>;
    } catch (err) {
      console.error(`  Batch ${i}-${i + INDUSTRY_BATCH}: Claude error —`, (err as Error).message);
      continue;
    }

    if (!result) {
      console.error(`  Batch ${i}-${i + INDUSTRY_BATCH}: could not parse response`);
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const labels = result[String(j)];
      if (!labels?.length) { skipped++; continue; }

      // Use first label as the industry field, derive canonical tags from all
      const validLabels = labels.filter(l => INDUSTRY_VOCAB.includes(l));
      if (!validLabels.length) { skipped++; continue; }

      const primaryIndustry = validLabels[0];
      const newTags = tagsFromTopics(validLabels);
      const mergedTags = mergeTags(batch[j].tags, newTags);

      if (!dryRun) {
        await prisma.company.update({
          where: { id: batch[j].id },
          data: { industry: primaryIndustry, tags: mergedTags },
        });
      } else {
        console.log(`  [dry] ${batch[j].name}: industry=${primaryIndustry}, tags+=${newTags.join(",")}`);
      }
      updated++;
    }

    process.stdout.write(`  Progress: ${Math.min(i + INDUSTRY_BATCH, companies.length)}/${companies.length}\r`);
  }

  console.log(`\n  Updated: ${updated}, skipped (no match): ${skipped}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const doRegions = args.includes("--regions");
  const doIndustries = args.includes("--industries");

  if (!doRegions && !doIndustries) {
    console.log("Usage: npx tsx scripts/enrich-llm.ts [--regions] [--industries] [--dry-run]");
    process.exit(1);
  }

  if (dryRun) console.log("DRY RUN — no changes will be written\n");

  if (doRegions) await enrichRegions(dryRun);
  if (doIndustries) await enrichIndustries(dryRun);

  console.log("\nDone.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().finally(() => prisma.$disconnect()).catch(console.error);
}
