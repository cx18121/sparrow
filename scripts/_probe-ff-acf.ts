import "dotenv/config";
import axios from "axios";

// Quick follow-up probe — every FF company doc has an `acf` block we're not
// requesting in the main scraper. Inspect contents to find a stage field.
// Run: tsx scripts/_probe-ff-acf.ts

const WP = "https://foundersfund.com/wp-json/wp/v2";

async function main() {
  const { data } = await axios.get(`${WP}/company`, {
    params: { per_page: 5, _fields: "id,title,acf,profiles" },
    timeout: 20_000,
  });
  for (const c of data) {
    console.log(`\n=== ${c.title?.rendered} ===`);
    console.log("acf:", JSON.stringify(c.acf, null, 2)?.slice(0, 1500));
  }
}
main().catch(err => { console.error(err); process.exit(1); });
