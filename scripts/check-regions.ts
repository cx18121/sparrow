import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { US_REGIONS } from "./_lib/region-map.js";

async function main() {
  const rows = await prisma.company.groupBy({
    by: ["region"],
    where: { isVerified: true },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  const nullCount = rows.find(r => r.region === null)?._count.id ?? 0;
  const remoteCount = rows.find(r => r.region === "Remote")?._count.id ?? 0;
  const usCount = rows.filter(r => r.region && US_REGIONS.has(r.region)).reduce((s, r) => s + r._count.id, 0);
  const unclassified = rows.filter(r => r.region && !US_REGIONS.has(r.region) && r.region !== "Remote");

  console.log("NULL region:", nullCount);
  console.log("Remote:", remoteCount);
  console.log("US regions (classified):", usCount);
  console.log("\nUnclassified (non-null, non-Remote, non-US):");
  for (const r of unclassified) console.log(" ", r._count.id, r.region);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().finally(() => prisma.$disconnect()).catch(console.error);
}
