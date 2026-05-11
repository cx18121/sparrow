import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";

// Pear's portfolio page didn't yield to standard selectors — find out
// where the company list actually lives.

async function main() {
  const { data: html } = await axios.get<string>("https://pear.vc/companies/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
    timeout: 30_000,
  });
  const $ = cheerio.load(html);

  // 1. All internal /companies/* links — these are presumably the company detail pages.
  console.log("All /companies/<slug> links (first 30):");
  const slugs = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/^(?:https?:\/\/[^/]+)?\/companies\/([^/?#]+)\/?/);
    if (m && m[1] !== "" && m[1] !== "companies") slugs.add(m[1]);
  });
  for (const s of [...slugs].slice(0, 30)) console.log("  ", s);
  console.log(`Total unique company slugs: ${slugs.size}`);

  // 2. The element wrapping a typical /companies/<slug> link, and a few of
  // its ancestors. Helps me write the right item selector.
  console.log("\nFirst /companies/<slug> link's ancestor chain:");
  const firstLink = $("a[href*='/companies/']").filter((_, el) => {
    const href = $(el).attr("href") ?? "";
    return /\/companies\/[^/?#]+/.test(href) && !href.endsWith("/companies/");
  }).first();
  if (firstLink.length) {
    let cur: any = firstLink;
    for (let i = 0; i < 6; i++) {
      const cls = cur.attr("class") ?? "(no class)";
      const tag = cur.prop("tagName")?.toLowerCase();
      console.log(`  ${i === 0 ? "[link]   " : `[parent ${i}]`} <${tag}> class=${cls.slice(0, 100)}`);
      cur = cur.parent();
      if (!cur || !cur.length) break;
    }

    console.log("\nFirst link inner HTML (compact):");
    console.log("  " + (firstLink.html() ?? "").replace(/\s+/g, " ").trim().slice(0, 500));
  } else {
    console.log("  no /companies/<slug> link found");
  }

  // 3. Are there embedded JSON or window.__data blocks?
  console.log("\nSearching for inline JSON dataset:");
  const interesting = ["__INITIAL_STATE__", "__data", "window.companies", "wpData", "pearCompanies"];
  for (const k of interesting) {
    if (html.includes(k)) console.log(`  found marker: ${k}`);
  }

  // 4. List ALL script tag contents that look like JSON arrays.
  let arrayBlocks = 0;
  $("script").each((_, el) => {
    const text = $(el).html() ?? "";
    if (/\bvar\s+\w+\s*=\s*\[\s*{/.test(text) || /=\s*\[\s*{\s*"\w+":/.test(text)) {
      arrayBlocks++;
      if (arrayBlocks <= 3) {
        console.log(`\n  [script ${arrayBlocks}] (first 300 chars):`);
        console.log("    " + text.replace(/\s+/g, " ").slice(0, 300));
      }
    }
  });
  console.log(`Total inline JSON-array script blocks: ${arrayBlocks}`);
}
main().catch(err => { console.error(err); process.exit(1); });
