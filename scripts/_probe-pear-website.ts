import "dotenv/config";
import axios from "axios";

async function main() {
  const all: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const { data } = await axios.get("https://pear.vc/wp-json/wp/v2/pear_vc_company", {
      params: { per_page: 100, page, _fields: "slug,title,link,meta" },
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 20_000,
    });
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < 100) break;
  }

  let withMetaWebsite = 0;
  let linkIsPearVc = 0;
  let linkExternal = 0;
  let bothMissing = 0;
  const examples: any[] = [];

  for (const r of all) {
    const meta = r.meta?.website_url ?? "";
    const link = r.link ?? "";
    const linkHost = (() => { try { return new URL(link).hostname; } catch { return ""; } })();
    if (meta) withMetaWebsite++;
    if (linkHost === "pear.vc" || linkHost.endsWith(".pear.vc")) linkIsPearVc++;
    else if (linkHost) linkExternal++;
    if (!meta && (!linkHost || linkHost === "pear.vc" || linkHost.endsWith(".pear.vc"))) {
      bothMissing++;
      if (examples.length < 5) examples.push({ slug: r.slug, link, meta });
    }
  }

  console.log(`total: ${all.length}`);
  console.log(`meta.website_url populated: ${withMetaWebsite}`);
  console.log(`link external:              ${linkExternal}`);
  console.log(`link points to pear.vc:     ${linkIsPearVc}`);
  console.log(`both missing:               ${bothMissing}`);
  console.log("\nexamples of both-missing:", examples);

  // What does a typical meta look like?
  const sample = all.find(r => r.meta?.website_url);
  if (sample) {
    console.log("\nsample meta with website_url:");
    console.log(JSON.stringify(sample.meta, null, 2).slice(0, 600));
  }
}
main().catch(err => { console.error(err); process.exit(1); });
