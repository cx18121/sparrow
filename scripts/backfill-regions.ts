import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { normalizeRegion } from "./_lib/region-map.js";

async function backfillRegions(): Promise<void> {
  console.log("Re-normalizing company regions from stored location strings...\n");

  const companies = await prisma.company.findMany({
    where: { location: { not: null } },
    select: { id: true, location: true, region: true },
  });

  console.log(`Found ${companies.length} companies with a location string.`);

  let updated = 0;
  let nulled = 0;

  for (const company of companies) {
    const newRegion = normalizeRegion(company.location);
    if (newRegion === company.region) continue;

    await prisma.company.update({
      where: { id: company.id },
      data: { region: newRegion },
    });

    if (newRegion === null) nulled++;
    else updated++;
  }

  console.log(`\nDone.`);
  console.log(`  Re-mapped to recognized region: ${updated}`);
  console.log(`  Nulled out (job titles / garbage): ${nulled}`);
  console.log(`  Unchanged: ${companies.length - updated - nulled}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillRegions().finally(() => prisma.$disconnect()).catch(console.error);
}

export { backfillRegions };
