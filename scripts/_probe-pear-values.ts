import "dotenv/config";
import axios from "axios";

async function main() {
  const all: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const { data } = await axios.get("https://pear.vc/wp-json/wp/v2/pear_vc_company", {
      params: { per_page: 100, page, _fields: "slug,title,link,company_group,current_stage,class_list" },
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 20_000,
    });
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < 100) break;
  }
  console.log(`fetched ${all.length} records`);

  const groupVals = new Map<string, number>();
  const stageVals = new Map<string, number>();
  const sectorVals = new Map<string, number>();
  let withLink = 0;

  for (const r of all) {
    const groups = Array.isArray(r.company_group) ? r.company_group : [r.company_group];
    for (const g of groups) {
      const k = String(g);
      groupVals.set(k, (groupVals.get(k) ?? 0) + 1);
    }
    const stages = Array.isArray(r.current_stage) ? r.current_stage : [r.current_stage];
    for (const s of stages) {
      const k = String(s);
      stageVals.set(k, (stageVals.get(k) ?? 0) + 1);
    }
    for (const c of (r.class_list ?? []) as string[]) {
      const m = c.match(/^pear_vc_company_sector-(.+)$/);
      if (m) sectorVals.set(m[1], (sectorVals.get(m[1]) ?? 0) + 1);
    }
    if (typeof r.link === "string" && r.link) withLink++;
  }

  console.log(`with link: ${withLink}/${all.length}`);
  console.log("\ncompany_group values:");
  for (const [v, n] of [...groupVals.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v.padEnd(15)} ${n}`);
  console.log("\ncurrent_stage values:");
  for (const [v, n] of [...stageVals.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v.padEnd(15)} ${n}`);
  console.log("\ntop sector slugs:");
  for (const [v, n] of [...sectorVals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${v.padEnd(30)} ${n}`);

  // sample: a record with company_group set
  const exit = all.find(r => Array.isArray(r.company_group) && r.company_group.length > 0);
  if (exit) {
    console.log(`\nsample record with company_group:`);
    console.log(`  slug: ${exit.slug}, group: ${JSON.stringify(exit.company_group)}, stage: ${JSON.stringify(exit.current_stage)}, link: ${exit.link}`);
  }
}
main().catch(err => { console.error(err); process.exit(1); });
