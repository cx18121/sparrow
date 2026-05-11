import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";

async function main() {
  const { data: html } = await axios.get<string>("https://lsvp.com/portfolio/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
    timeout: 30_000,
  });
  const $ = cheerio.load(html);

  // Find the actual portfolio list — there are two sections per the
  // ancestor chain: founder-spotlight and section-companies.
  const section = $("#section-companies");
  console.log("Section #section-companies HTML length:", section.html()?.length ?? 0);

  // Top-level children of #section-companies
  console.log("\nDirect children of #section-companies:");
  section.children().each((i, el) => {
    const $el = $(el);
    const tag = $el.prop("tagName")?.toLowerCase();
    const cls = ($el.attr("class") ?? "").slice(0, 80);
    console.log(`  [${i}] <${tag}> class="${cls}"`);
  });

  // Within #section-companies, find a likely company-card wrapper.
  console.log("\nClass-name frequency within #section-companies:");
  const tally = new Map<string, number>();
  section.find("[class]").each((_, el) => {
    for (const c of ($(el).attr("class") ?? "").split(/\s+/).filter(Boolean)) {
      tally.set(c, (tally.get(c) ?? 0) + 1);
    }
  });
  [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([c, n]) => {
    console.log(`  ${c.padEnd(40)} ${n}`);
  });

  // Find `a` elements within section-companies — likely each is one
  // company wrapper given the earlier ancestor chain hinted at <a>.
  console.log("\nDirect <a> children of any descendant in #section-companies:");
  const anchors = section.find("a");
  console.log(`  total <a>: ${anchors.length}`);
  console.log("\n  First 3 <a> classes / href / text:");
  anchors.slice(0, 3).each((i, el) => {
    const $el = $(el);
    const cls = ($el.attr("class") ?? "").slice(0, 60);
    const href = $el.attr("href") ?? "";
    const text = $el.text().trim().replace(/\s+/g, " ").slice(0, 100);
    console.log(`  [${i}] class="${cls}" href="${href}" text="${text}"`);
  });

  // Take the first <a> and inspect its structure for name + stage extract
  console.log("\n--- first <a>.html() (compact, 1500 chars) ---");
  console.log((anchors.first().html() ?? "").replace(/\s+/g, " ").slice(0, 1500));
}
main().catch(err => { console.error(err); process.exit(1); });
