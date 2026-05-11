import "dotenv/config";
import axios from "axios";

// Pear's portfolio uses a WordPress custom post type `pear_vc_company`.
// Check whether the REST API exposes it.
const BASES = [
  "https://pear.vc/wp-json/wp/v2/pear_vc_company",
  "https://pear.vc/wp-json/wp/v2/company",
  "https://pear.vc/wp-json/wp/v2/companies",
  "https://pear.vc/wp-json/wp/v2/types",
];

async function main() {
  for (const url of BASES) {
    try {
      const { data, headers } = await axios.get(url, {
        params: { per_page: 5 },
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
        timeout: 15_000,
      });
      const total = headers["x-wp-total"];
      const pages = headers["x-wp-totalpages"];
      console.log(`\n${url}`);
      console.log(`  total: ${total}, pages: ${pages}`);
      if (Array.isArray(data)) {
        const sample = data[0] ?? {};
        console.log(`  sample keys: ${Object.keys(sample).slice(0, 25).join(", ")}`);
        if (sample.title?.rendered) console.log(`  title: ${sample.title.rendered}`);
        if (sample.link) console.log(`  link: ${sample.link}`);
        if (sample.acf) console.log(`  acf: ${JSON.stringify(sample.acf).slice(0, 300)}`);
        if (sample.meta) console.log(`  meta: ${JSON.stringify(sample.meta).slice(0, 300)}`);
        if (sample.class_list) console.log(`  class_list: ${(sample.class_list as string[]).slice(0, 10).join(", ")}`);
      } else {
        console.log(`  keys: ${Object.keys(data).slice(0, 30).join(", ")}`);
      }
    } catch (err: any) {
      console.log(`\n${url}: ${err.response?.status ?? "ERR"} ${err.message}`);
    }
  }
}
main().catch(err => { console.error(err); process.exit(1); });
