import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runManifest } from "./_lib/manifest-ingestor.js";
import type { Manifest } from "./_lib/manifest-types.js";

// Generic CLI for manifest-driven ingestors. Pass one or more manifest paths
// (relative to the repo root). Each is run sequentially through the shared
// runIngestor pipeline.
//
// Usage:
//   tsx scripts/ingest-from-manifest.ts sources/pear.json
//   tsx scripts/ingest-from-manifest.ts sources/pear.json sources/wave.json

async function main(paths: string[]) {
  if (paths.length === 0) {
    console.error("Usage: tsx scripts/ingest-from-manifest.ts <manifest.json> [...more]");
    process.exit(2);
  }

  for (const p of paths) {
    const abs = resolve(process.cwd(), p);
    const raw = readFileSync(abs, "utf-8");
    const manifest = JSON.parse(raw) as Manifest;
    console.log(`\n=== ${manifest.name} (${manifest.source}) ===`);
    await runManifest(manifest);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
