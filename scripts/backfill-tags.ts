import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { buildTags, mergeTags, tagsFromTopics } from "./_lib/tags.js";

// Location strings that get scraped into industry fields (e.g. Bessemer's
// sector selector includes geographic options). Clear them rather than
// treating them as industry labels.
const LOCATION_INDUSTRIES = new Set(["India", "Europe", "US", "UK", "APAC", "EMEA", "Global"]);

async function backfillTags(): Promise<void> {
  console.log("Scanning companies for tag drift...\n");

  const companies = await prisma.company.findMany({
    select: {
      id: true,
      industry: true,
      subIndustry: true,
      stage: true,
      headcount: true,
      tags: true,
      source: true,
    },
  });

  console.log(`Found ${companies.length} companies.`);

  let updated = 0;
  let tagsAdded = 0;
  let industryCleared = 0;

  for (const company of companies) {
    const updateData: Record<string, unknown> = {};

    // Clear location strings mistakenly stored as industry
    if (company.industry && LOCATION_INDUSTRIES.has(company.industry)) {
      updateData.industry = null;
      industryCleared++;
    }

    const effectiveIndustry =
      "industry" in updateData ? null : company.industry;

    // Derive canonical tags from industry + subIndustry
    const derivedTopics = [
      ...(effectiveIndustry ? [effectiveIndustry] : []),
      ...(company.subIndustry ? [company.subIndustry] : []),
    ];
    const newTags = buildTags({
      topics: derivedTopics,
      stage: company.stage ?? undefined,
      headcount: company.headcount ?? undefined,
    });

    // Strip any pre-existing tags that belong to namespaces we now fully
    // control via buildTags, so stale / misspelled tags get replaced.
    const MANAGED_NAMESPACES = new Set([
      "vertical", "tech", "model", "function", "media", "social", "stage", "size",
    ]);
    const survivingTags = company.tags.filter(t => {
      const ns = t.includes(":") ? t.split(":")[0] : null;
      return !ns || !MANAGED_NAMESPACES.has(ns);
    });

    const merged = mergeTags(survivingTags, newTags);

    // Sort for stable comparison
    const sortedOld = [...company.tags].sort().join(",");
    const sortedNew = [...merged].sort().join(",");

    if (sortedOld !== sortedNew) {
      const added = merged.filter(t => !company.tags.includes(t)).length;
      updateData.tags = merged;
      tagsAdded += added;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.company.update({ where: { id: company.id }, data: updateData });
      updated++;
    }
  }

  console.log(`\nDone.`);
  console.log(`  Companies scanned:   ${companies.length}`);
  console.log(`  Companies updated:   ${updated}`);
  console.log(`  Tags added:          ${tagsAdded}`);
  console.log(`  Industry rows cleared: ${industryCleared}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillTags().finally(() => prisma.$disconnect()).catch(console.error);
}

export { backfillTags };
