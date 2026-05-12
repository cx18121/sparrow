// Smoke test for the Exa-discovery extraction path used by
// ingest-exa-discovery.ts. Issues one real Exa search with category=company,
// prints every result's title/url/first-sentence so we can lock in the
// title-parsing and URL-canonicalization heuristics before writing the
// adapter. Run once.
//
//   tsx scripts/_probe-exa-discovery.ts

import "dotenv/config";
import { exaSearch } from "../server/lib/ai/exa-search.js";

async function main() {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    console.error("EXA_API_KEY missing");
    process.exit(1);
  }
  const query = "AI infrastructure startup Series B 2024 2025";
  console.log(`Query: ${query}\nCategory: company\nNumResults: 20\n`);

  const resp = await exaSearch({
    query,
    apiKey,
    numResults: 20,
    type: "auto",
    category: "company",
    textMaxCharacters: 600,
  });
  if (resp.autopromptString) console.log(`autoprompt → ${resp.autopromptString}\n`);

  for (const r of resp.results) {
    const firstSentence = (r.content.split(/(?<=[.!?])\s+/)[0] ?? "").slice(0, 220);
    console.log(`  url:   ${r.url}`);
    console.log(`  title: ${r.title}`);
    console.log(`  date:  ${r.publishedDate ?? "—"}  score: ${r.score?.toFixed(3) ?? "—"}`);
    console.log(`  text:  ${firstSentence}\n`);
  }
  console.log(`Total: ${resp.results.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
