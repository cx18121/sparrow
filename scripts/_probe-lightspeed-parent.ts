import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";

async function main() {
  const { data: html } = await axios.get<string>("https://lsvp.com/portfolio/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
    timeout: 30_000,
  });
  const $ = cheerio.load(html);

  // Walk ancestors of the first .company-info-list block to find a
  // company-wrapper. Look for an element that holds both the head and
  // the info-list as siblings.
  const infoList = $(".company-info-list").first();
  console.log("Ancestor chain of .company-info-list[0]:");
  let cur: any = infoList.parent();
  for (let i = 1; i <= 8; i++) {
    if (!cur || !cur.length) break;
    const tag = cur.prop("tagName")?.toLowerCase();
    const cls = (cur.attr("class") ?? "").slice(0, 70);
    const id = cur.attr("id") ?? "";
    const childCount = cur.children().length;
    console.log(`  [${i}] <${tag}> class="${cls}" id="${id}" children=${childCount}`);
    cur = cur.parent();
  }

  // Try: the parent of .company-info-list might itself be a company. Check
  // sibling structure.
  console.log("\nSiblings of .company-info-list[0].parent (first 5):");
  const parent = $(".company-info-list").first().parent();
  parent.children().slice(0, 5).each((i, el) => {
    const $el = $(el);
    const tag = $el.prop("tagName")?.toLowerCase();
    const cls = ($el.attr("class") ?? "").slice(0, 60);
    console.log(`  [${i}] <${tag}> class="${cls}"`);
  });

  // Direct candidate selectors based on Exa research mentioning "cards":
  console.log("\nMore candidates:");
  for (const sel of [
    "article",
    ".card",
    ".company",
    ".portfolio-company",
    ".portfolio__row",
    ".portfolio-row",
    ".col-l",
    ".col-r",
    ".detail",
    "[data-portfolio]",
    "section.companies > div",
    ".no-barba-prefetch",
  ]) {
    const n = $(sel).length;
    if (n > 0) console.log(`  ${sel.padEnd(36)} → ${n}`);
  }

  // Maybe the wrapper has the name. Look for the company name pattern.
  // From earlier probe, .block had <h3>Dario Amodei</h3> for an Anthropic
  // partner card. So name probably lives in an h2 / .name / data-name
  // element of the wrapper itself.
  console.log("\nh2 / h3 inside potential wrappers (sample):");
  $(".col-l").slice(0, 3).each((i, el) => {
    const $el = $(el);
    console.log(`  col-l[${i}]: h2='${$el.find("h2").first().text().trim()}' h3='${$el.find("h3").first().text().trim()}'`);
  });

  // What about <a href="..."> that point to a specific company page or
  // external company website?
  console.log("\nLinks inside .col-l (first 5 distinct hrefs):");
  const hrefs = new Set<string>();
  $(".col-l a[href]").each((_, el) => {
    if (hrefs.size >= 8) return;
    const h = $(el).attr("href") ?? "";
    if (h && !hrefs.has(h)) { hrefs.add(h); }
  });
  for (const h of hrefs) console.log("  " + h);
}
main().catch(err => { console.error(err); process.exit(1); });
