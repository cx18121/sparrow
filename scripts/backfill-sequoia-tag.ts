import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";

async function run() {
  const result = await prisma.$executeRaw`
    UPDATE "Company"
    SET tags = array_append(tags, 'investor:sequoia')
    WHERE source = 'sequoia'
      AND NOT ('investor:sequoia' = ANY(tags))
  `;
  console.log(`Updated ${result} companies with investor:sequoia tag.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().finally(() => prisma.$disconnect()).catch(console.error);
}
