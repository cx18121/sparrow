import "dotenv/config";
import axios from "axios";

// Probe GV's Sanity dataset to see what fields are available on company docs.
// Our scraper currently only asks for `name, website, sector` — if Sanity
// holds a stage / funding-stage / fund field too, surface it.
//
// Run: tsx scripts/_probe-gv-schema.ts

const SANITY_API = "https://v5ygm6ip.api.sanity.io/v2021-10-21/data/query/production";

async function main() {
  // Two GROQ queries: one expands a single company doc fully so we see
  // every field; the other counts docs by _type so we know if there are
  // related docs (Fund, Stage, Round) worth joining.
  const fullDocQuery = `*[_type=="company"][0..2]{...}`;
  const typeCountsQuery = `*[]{ "type": _type } | order(type asc)`;

  const [{ data: full }, { data: typeCounts }] = await Promise.all([
    axios.get(SANITY_API, { params: { query: fullDocQuery }, timeout: 15_000 }),
    axios.get(SANITY_API, { params: { query: typeCountsQuery }, timeout: 30_000 }),
  ]);

  console.log("Sample 'company' docs (full fields):");
  for (const doc of full.result ?? []) {
    console.log("\n---");
    for (const [k, v] of Object.entries(doc)) {
      const display = typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80);
      console.log(`  ${k.padEnd(20)} ${display}`);
    }
  }

  console.log("\nDoc types present in dataset (counts):");
  const counts = new Map<string, number>();
  for (const r of (typeCounts.result as { type: string }[]) ?? []) {
    counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  }
  for (const [type, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(30)} ${n}`);
  }

  // Also probe an aiCompany doc since the scraper queries both.
  const aiQuery = `*[_type=="aiCompany"][0]{...}`;
  const { data: ai } = await axios.get(SANITY_API, { params: { query: aiQuery }, timeout: 15_000 });
  if (ai.result) {
    console.log("\nSample 'aiCompany' doc (full fields):");
    for (const [k, v] of Object.entries(ai.result)) {
      const display = typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80);
      console.log(`  ${k.padEnd(20)} ${display}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
