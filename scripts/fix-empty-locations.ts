import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";

async function main() {
  const result = await prisma.company.updateMany({
    where: { location: "" },
    data: { location: null },
  });
  console.log(`Nulled empty location strings on ${result.count} companies`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().finally(() => prisma.$disconnect()).catch(console.error);
