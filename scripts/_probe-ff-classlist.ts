import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";

// Probe FoundersFund — currently 100% null-staged in our DB. We already use
// class_list to extract industry via the company_industry-* pattern; check
// whether a parallel company_stage-* (or any other) pattern exists in the
// same WP taxonomy.
//
// Run: tsx scripts/_probe-ff-classlist.ts

const BASE_URL = "https://foundersfund.com/portfolio";

async function main() {
  const { data: html } = await axios.get<string>(BASE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
    timeout: 30_000,
  });

  const m = html.match(/window\.__data\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!m) {
    console.error("Could not find window.__data");
    process.exit(1);
  }
  const data = JSON.parse(m[1]);
  const companies: any[] = data.companies ?? [];

  console.log(`Total companies: ${companies.length}\n`);

  // Tally every class_list prefix seen across the corpus. The format is
  // `taxonomy-slug` per WP convention, so we group by the part before the
  // first hyphen-separated value.
  const prefixCounts = new Map<string, number>();
  const sampleByPrefix = new Map<string, Set<string>>();
  let withClassList = 0;
  for (const c of companies) {
    const cl: string[] = c.class_list ?? [];
    if (cl.length > 0) withClassList++;
    for (const cls of cl) {
      // Extract the prefix up to the last hyphen — `company_industry-fintech`
      // → `company_industry`, `tag-12` → `tag`.
      const idx = cls.lastIndexOf("-");
      if (idx === -1) continue;
      const prefix = cls.slice(0, idx);
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
      if (!sampleByPrefix.has(prefix)) sampleByPrefix.set(prefix, new Set());
      const samples = sampleByPrefix.get(prefix)!;
      if (samples.size < 5) samples.add(cls);
    }
  }

  console.log(`Rows with non-empty class_list: ${withClassList}\n`);
  console.log("class_list prefixes (top 30 by frequency):");
  const sorted = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  for (const [prefix, n] of sorted) {
    const samples = [...(sampleByPrefix.get(prefix) ?? [])].slice(0, 3).join(", ");
    console.log(`  ${prefix.padEnd(32)} ${String(n).padStart(5)}  e.g. ${samples}`);
  }

  // Also check the raw fields available on a company doc — in case stage
  // lives outside class_list (e.g. acf, profiles).
  console.log("\nFields on a sample company doc:");
  const sample = companies[0];
  if (sample) console.log(Object.keys(sample).sort());
}

main().catch((err) => { console.error(err); process.exit(1); });
