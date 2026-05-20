// Emits the landing-page proof-line stats as JSON on stdout. Called by
// `vite.config.ts` at production build time so the live company count
// and source count get baked into the bundle. Total company count
// (not verified-only) matches the historical hardcoded value the page
// has been shipping; "sources" is the count of distinct `source` values
// actually present in the DB, which tracks the number of ingest
// pipelines whose data is live.
import 'dotenv/config'
import { prisma } from './_lib/prisma.js'

async function main() {
  const [startups, distinctSources] = await Promise.all([
    prisma.company.count(),
    prisma.company.groupBy({ by: ['source'] }).then(g => g.length),
  ])
  process.stdout.write(JSON.stringify({ startups, sources: distinctSources }))
  await prisma.$disconnect()
}

main().catch(err => {
  // Print structured error to stderr so the Vite build can fall back
  // to the hardcoded defaults without polluting stdout (which is the
  // JSON payload channel).
  process.stderr.write(`[print-stats] ${(err as Error).message}\n`)
  process.exit(1)
})
