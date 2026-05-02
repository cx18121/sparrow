import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";

async function main() {
  const rows = await prisma.company.findMany({
    where: {
      isVerified: true,
      industry: null,
      OR: [{ oneLiner: { not: null } }, { description: { not: null } }],
    },
    select: { id: true, name: true, oneLiner: true, description: true },
    orderBy: { name: "asc" },
  });
  console.log(`Companies with null industry but a description: ${rows.length}`);
  // Sample 30 to gauge quality
  for (const r of rows.slice(0, 30)) {
    const desc = (r.oneLiner ?? r.description ?? "").slice(0, 80);
    console.log(`  [${r.name}] ${desc}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().finally(() => prisma.$disconnect()).catch(console.error);
