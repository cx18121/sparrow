import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";

async function main() {
  const { data: html } = await axios.get<string>("https://www.wave.ventures/founders", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
    timeout: 30_000,
  });
  const $ = cheerio.load(html);
  console.log("Sample 3 .sqs-block-image blocks — relevant innards:");
  $(".sqs-block-image").slice(0, 3).each((i, el) => {
    console.log(`\n=== block ${i} ===`);
    const $el = $(el);
    const a = $el.find("a").first();
    const img = $el.find("img").first();
    console.log(`  link href:   ${a.attr("href")}`);
    console.log(`  link target: ${a.attr("target")}`);
    console.log(`  img alt:     ${img.attr("alt")}`);
    console.log(`  img title:   ${img.attr("title")}`);
    console.log(`  img src:     ${(img.attr("src") ?? "").slice(0, 80)}`);
    console.log(`  data-image-title: ${$el.find("[data-image-title]").attr("data-image-title")}`);
    console.log(`  data-title:  ${$el.find("[data-title]").attr("data-title")}`);
  });
}
main().catch(err => { console.error(err); process.exit(1); });
