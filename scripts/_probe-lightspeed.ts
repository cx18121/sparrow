import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";

// Probe Lightspeed's portfolio page to ground the manifest selectors.
// Exa research said ~500 cos with name + founders + founded year + stage
// + Backed-Since + status. Goal: find the item selector, then the
// per-field selectors / attrs that surface the data we care about.
//
// Run: tsx scripts/_probe-lightspeed.ts

const URL = "https://lsvp.com/portfolio/";

async function main() {
  const { data: html } = await axios.get<string>(URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
    timeout: 30_000,
    maxRedirects: 5,
  });
  console.log(`HTML length: ${html.length}`);
  const $ = cheerio.load(html);

  // 1. Find candidate item selectors
  console.log("\n— item selector candidates:");
  const candidates = [
    ".portfolio-company",
    ".company-card",
    "article",
    ".portfolio__company",
    ".portfolio-item",
    "[data-company]",
    "li.portfolio",
    ".sp-portfolio-card",
    ".filter-portfolio-row",
  ];
  for (const sel of candidates) {
    const n = $(sel).length;
    if (n > 0) console.log(`  ${sel.padEnd(40)} → ${n}`);
  }

  // 2. If nothing obvious — tally most-frequent class names
  console.log("\n— top class names by frequency:");
  const tally = new Map<string, number>();
  $("[class]").each((_, el) => {
    for (const c of ($(el).attr("class") ?? "").split(/\s+/).filter(Boolean)) {
      tally.set(c, (tally.get(c) ?? 0) + 1);
    }
  });
  [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([c, n]) => {
    console.log(`  ${c.padEnd(50)} ${n}`);
  });

  // 3. Search for any links pointing to /portfolio/<slug> (per-company detail)
  console.log("\n— /portfolio/<slug> internal links (first 20):");
  const slugs = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/^(?:https?:\/\/[^/]+)?\/portfolio\/([^/?#]+)\/?/);
    if (m && m[1] !== "" && m[1] !== "portfolio") slugs.add(m[1]);
  });
  for (const s of [...slugs].slice(0, 20)) console.log("  ", s);
  console.log(`Total /portfolio/<slug> unique: ${slugs.size}`);

  // 4. Outbound external company links
  console.log("\n— outbound external links (first 15):");
  const ext = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href.startsWith("http")) return;
    try {
      const u = new URL(href);
      if (u.hostname.endsWith("lsvp.com") || /twitter|x\.com|linkedin|facebook|instagram|youtube|crunchbase/i.test(u.hostname)) return;
      if (ext.has(u.hostname)) return;
      ext.add(u.hostname);
      console.log(`  ${href}`);
    } catch {}
  });

  // 5. Sniff for inline JSON
  console.log("\n— inline JSON markers:");
  for (const k of ["__NUXT__", "__NEXT_DATA__", "__APOLLO_STATE__", "window.companies", "portfolio_data", "wpData"]) {
    if (html.includes(k)) console.log(`  found: ${k}`);
  }

  // 6. Look at a likely item element if any candidate matched
  for (const sel of [...candidates, "article", ".elementor-widget", "[role='listitem']"]) {
    const items = $(sel);
    if (items.length >= 50) {
      console.log(`\n— sample of ${sel} (first one's HTML, compact):`);
      const inner = (items.first().html() ?? "").replace(/\s+/g, " ").trim();
      console.log("  " + inner.slice(0, 800));
      break;
    }
  }
}
main().catch(err => { console.error(err); process.exit(1); });
