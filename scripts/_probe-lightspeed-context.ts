import "dotenv/config";
import axios from "axios";

async function main() {
  const { data: html } = await axios.get<string>("https://lsvp.com/portfolio/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
    timeout: 30_000,
  });

  // Find every occurrence of "window.companies" and dump 80 chars around it.
  let i = 0;
  let n = 0;
  while ((i = html.indexOf("window.companies", i)) !== -1 && n < 5) {
    const start = Math.max(0, i - 50);
    const end = Math.min(html.length, i + 200);
    console.log(`\n--- match ${++n} at ${i} ---`);
    console.log(html.slice(start, end).replace(/\s+/g, " "));
    i += 1;
  }

  // Also list every script src and a hint of inline script size.
  console.log("\n--- inline <script> blocks longer than 1KB ---");
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  let scriptIdx = 0;
  while ((m = re.exec(html)) !== null) {
    scriptIdx++;
    const body = m[1];
    if (body.length > 1024) {
      console.log(`  [#${scriptIdx}] ${body.length} chars — first 200:`);
      console.log("    " + body.slice(0, 200).replace(/\s+/g, " "));
    }
  }
}
main().catch(err => { console.error(err); process.exit(1); });
