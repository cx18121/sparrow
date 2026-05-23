// Recompute and persist the /api/campaign-options snapshot.
//
// Run after an ingest session completes (Company rows changed → filter
// chip data needs to reflect the new state). Idempotent — safe to run
// repeatedly. Takes ~1–5s depending on Company size; the bottleneck is
// the unnest(tags) GROUP BY tag aggregation.
//
// Usage:
//   npx tsx scripts/refresh-company-options.ts

import "dotenv/config";
import { refreshCompanyOptionsSnapshot } from "../server/lib/company-options.js";

async function main() {
  const startedAt = Date.now();
  const payload = await refreshCompanyOptionsSnapshot();
  const elapsed = Date.now() - startedAt;

  const tagCount = Object.values(payload.tags).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`✓ Refreshed CompanyOptionsSnapshot in ${elapsed}ms`);
  console.log(`  industries=${payload.industries.length}  regions=${payload.regions.length}  stages=${payload.stages.length}  batches=${payload.batches.length}  sources=${payload.sources.length}`);
  console.log(`  tag facets=${tagCount}  hiring=${payload.hiringCount}  us=${payload.usCount}  intl=${payload.intlCount}  remote=${payload.remoteCount}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("✗ Refresh failed:", err);
    process.exit(1);
  });
