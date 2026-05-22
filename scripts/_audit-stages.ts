import "dotenv/config";
import { prisma } from "./_lib/prisma.js";

async function main() {
  // Per-source: how many verified rows have stage = null vs known?
  const sources = await prisma.company.groupBy({
    by: ["source"],
    where: { isVerified: true },
    _count: true,
    orderBy: { _count: { source: "desc" } },
  });

  console.log(`source                     total  null-stage  null%  series-a  series-b`);
  console.log(`-----                      -----  ----------  -----  --------  --------`);
  for (const r of sources.slice(0, 30)) {
    const src = r.source ?? "<null>";
    const total = r._count;
    const nullN = await prisma.company.count({ where: { isVerified: true, source: src, stage: null } });
    const a = await prisma.company.count({ where: { isVerified: true, source: src, stage: { in: ["Series A", "Series A+"] } } });
    const b = await prisma.company.count({ where: { isVerified: true, source: src, stage: { in: ["Series B", "Series B+"] } } });
    const pct = ((nullN / total) * 100).toFixed(0);
    console.log(`${src.padEnd(25)} ${total.toString().padStart(6)}  ${nullN.toString().padStart(10)}  ${pct.padStart(4)}%  ${a.toString().padStart(8)}  ${b.toString().padStart(8)}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
