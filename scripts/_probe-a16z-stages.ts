import "dotenv/config";
import axios from "axios";

// One-off probe to answer: what stage tags does a16z actually put on companies
// in window.a16z_portfolio_companies, and in what proportions? Used to decide
// whether `seed` should map to Seed or Pre-Seed (and similar for `early`).
// Not part of the regular ingest pipeline — delete after deciding.
//
// Run: tsx scripts/_probe-a16z-stages.ts

const BASE_URL = "https://a16z.com/portfolio";

// Copy of the parser from scripts/ingest-a16z.ts so the probe matches the
// scraper exactly. Returns the parsed inline array or null.
function extractJsonArray(html: string, varName: string): unknown[] | null {
  const prefix = `window.${varName} = `;
  const start = html.indexOf(prefix);
  if (start === -1) return null;
  const arrayStart = html.indexOf("[", start + prefix.length);
  if (arrayStart === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let i = arrayStart;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString) {
      if (ch === "[") depth++;
      if (ch === "]") {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(html.slice(arrayStart, i + 1)); }
          catch { return null; }
        }
      }
    }
  }
  return null;
}

async function main() {
  const { data: html } = await axios.get<string>(BASE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
    timeout: 30_000,
  });

  const companies = extractJsonArray(html, "a16z_portfolio_companies");
  if (!companies) {
    console.error("Could not parse a16z_portfolio_companies");
    process.exit(1);
  }

  console.log(`Total companies: ${companies.length}\n`);

  // Tag distribution from stages[] (multi-value) and stage (single-value)
  const stagesValues = new Map<string, number>();
  const stageValues = new Map<string, number>();
  const combined = new Map<string, number>();
  let neither = 0;

  for (const c of companies as any[]) {
    const ss = Array.isArray(c.stages) ? c.stages : [];
    const s = typeof c.stage === "string" && c.stage ? [c.stage] : [];
    for (const v of ss) stagesValues.set(v, (stagesValues.get(v) ?? 0) + 1);
    for (const v of s) stageValues.set(v, (stageValues.get(v) ?? 0) + 1);
    const all = [...ss, ...s].map((v: string) => v.toLowerCase()).sort();
    if (all.length === 0) { neither++; continue; }
    const key = JSON.stringify(all);
    combined.set(key, (combined.get(key) ?? 0) + 1);
  }

  console.log("stages[] values:");
  for (const [v, n] of [...stagesValues.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.padEnd(20)} ${n}`);
  }
  console.log("\nstage (scalar) values:");
  for (const [v, n] of [...stageValues.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.padEnd(20)} ${n}`);
  }
  console.log("\nCombined stage signature (lowercased + sorted):");
  for (const [k, n] of [...combined.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(40)} ${n}`);
  }
  console.log(`\nNo stage tag at all: ${neither} (${(neither / companies.length * 100).toFixed(1)}%)`);

  // Also peek at one company that's tagged "seed" and one tagged "early" to
  // see if the rest of their fields hint at actual stage. e.g. "Stripe"
  // would have us know what bucket they're really in.
  const sampleByTag = (tag: string) =>
    (companies as any[])
      .filter((c) =>
        [...((c.stages as string[]) ?? []), c.stage ?? ""]
          .some((v) => typeof v === "string" && v.toLowerCase() === tag)
      )
      .slice(0, 5)
      .map((c) => c.title);

  console.log("\nSample companies tagged 'seed':", sampleByTag("seed"));
  console.log("Sample companies tagged 'early':", sampleByTag("early"));
  console.log("Sample companies tagged 'growth':", sampleByTag("growth"));
  console.log("Sample companies tagged 'late':", sampleByTag("late"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
