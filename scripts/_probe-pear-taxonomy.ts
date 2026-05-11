import "dotenv/config";
import axios from "axios";

async function probe(endpoint: string) {
  const url = `https://pear.vc/wp-json/wp/v2/${endpoint}`;
  try {
    const { data, headers } = await axios.get(url, {
      params: { per_page: 100 },
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 15_000,
    });
    console.log(`\n${endpoint} — total ${headers["x-wp-total"] ?? "?"}, pages ${headers["x-wp-totalpages"] ?? "?"}`);
    if (Array.isArray(data)) {
      for (const t of data.slice(0, 20)) {
        console.log(`  id=${t.id} slug=${t.slug} name="${t.name}" count=${t.count ?? "?"}`);
      }
      if (data.length > 20) console.log(`  ... and ${data.length - 20} more`);
    } else {
      console.log("  (not an array)");
    }
  } catch (err: any) {
    console.log(`${endpoint}: ${err.response?.status ?? "ERR"} ${err.message}`);
  }
}

(async () => {
  for (const ep of ["current_stage", "pear_vc_company_sector", "company_group"]) {
    await probe(ep);
  }
})().catch(err => { console.error(err); process.exit(1); });
