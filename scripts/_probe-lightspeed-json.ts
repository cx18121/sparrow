import "dotenv/config";
import axios from "axios";

// Lightspeed embeds portfolio data as window.companies in the page.
// Extract and inspect the array shape so we know if a manifest strategy
// fits or if a hand-coded adapter is needed.

function extractJsonArray(html: string, varName: string): unknown[] | null {
  const patterns = [
    `window.${varName} = `,
    `window.${varName}=`,
    `var ${varName} = `,
    `var ${varName}=`,
  ];
  let start = -1;
  for (const p of patterns) {
    const idx = html.indexOf(p);
    if (idx !== -1) { start = idx + p.length; break; }
  }
  if (start === -1) return null;
  const arrayStart = html.indexOf("[", start);
  if (arrayStart === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = arrayStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString) {
      if (ch === "[") depth++;
      if (ch === "]") {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(html.slice(arrayStart, i + 1)); } catch { return null; }
        }
      }
    }
  }
  return null;
}

async function main() {
  const { data: html } = await axios.get<string>("https://lsvp.com/portfolio/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
    timeout: 30_000,
  });

  const arr = extractJsonArray(html, "companies");
  if (!arr) {
    console.error("Could not extract window.companies");
    process.exit(1);
  }
  console.log(`window.companies: ${arr.length} records`);

  // Field shape on a sample record
  const sample = arr[0] as any;
  console.log("\nSample 0 keys:", Object.keys(sample).slice(0, 30));
  console.log("\nSample 0 (truncated):");
  for (const [k, v] of Object.entries(sample)) {
    const display = typeof v === "object" ? JSON.stringify(v).slice(0, 100) : String(v).slice(0, 100);
    console.log(`  ${k.padEnd(20)} ${display}`);
  }

  // Tally values for any stage-like field
  const stageLike = ["stage", "current_stage", "status", "backed_since", "current_round"];
  for (const f of stageLike) {
    const counts = new Map<string, number>();
    for (const c of arr as any[]) {
      const v = c[f];
      if (v == null) continue;
      const key = Array.isArray(v) ? JSON.stringify(v) : String(v);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (counts.size > 0) {
      console.log(`\nField '${f}' values:`);
      for (const [v, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        console.log(`  ${v.padEnd(30)} ${n}`);
      }
    }
  }

  // Quick check: how many records have a usable website URL?
  let withWebsite = 0;
  const urlFields = new Set<string>();
  for (const c of arr as any[]) {
    for (const [k, v] of Object.entries(c)) {
      if (typeof v === "string" && /^https?:\/\//.test(v) && !v.includes("lsvp.com")) {
        urlFields.add(k);
      }
    }
    if (typeof c.url === "string" || typeof c.website === "string" || typeof c.link === "string") withWebsite++;
  }
  console.log(`\nFields ever holding a URL: ${[...urlFields].join(", ")}`);
  console.log(`Records with url/website/link string: ${withWebsite}`);
}
main().catch(err => { console.error(err); process.exit(1); });
