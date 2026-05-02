import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";

async function main() {
  const rows = await prisma.company.findMany({
    where: { isVerified: true, location: { not: null }, region: null },
    select: { id: true, location: true },
    orderBy: { location: "asc" },
  });
  const grouped: Record<string, string[]> = {};
  for (const r of rows) {
    const loc = r.location!;
    (grouped[loc] ??= []).push(r.id);
  }
  for (const [loc, ids] of Object.entries(grouped).sort((a,b) => b[1].length - a[1].length)) {
    console.log(`${ids.length}\t${loc}`);
  }
  console.log(`\nTotal unique: ${Object.keys(grouped).length}, total companies: ${rows.length}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().finally(() => prisma.$disconnect()).catch(console.error);
