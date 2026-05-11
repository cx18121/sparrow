import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";

async function main() {
  const { data: html } = await axios.get<string>("https://lsvp.com/portfolio/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
    timeout: 30_000,
  });
  const $ = cheerio.load(html);

  console.log(`.block: ${$(".block").length}`);

  // Compare with more-specific descendants
  const sels = [
    ".block.no-barba-prefetch",
    "[data-name]",
    ".portfolio-list .block",
    "section .block",
    "a.block",
    ".block .name",
  ];
  for (const sel of sels) {
    console.log(`${sel.padEnd(36)} → ${$(sel).length}`);
  }

  // Dump 2 sample .block elements
  console.log("\n--- sample .block #0 outer (compact) ---");
  console.log($(".block").eq(0).toString().replace(/\s+/g, " ").slice(0, 1200));
  console.log("\n--- sample .block #1 outer (compact) ---");
  console.log($(".block").eq(1).toString().replace(/\s+/g, " ").slice(0, 1200));

  // What attributes / data-* fields do .block elements typically have?
  console.log("\n--- attributes on first 5 .block elements ---");
  $(".block").slice(0, 5).each((i, el) => {
    const attribs: any = (el as any).attribs ?? {};
    console.log(`  [${i}] ${Object.entries(attribs).map(([k, v]) => `${k}="${String(v).slice(0, 50)}"`).join(" ")}`);
  });
}
main().catch(err => { console.error(err); process.exit(1); });
