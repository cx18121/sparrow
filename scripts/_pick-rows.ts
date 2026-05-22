import "dotenv/config";
import { prisma } from "./_lib/prisma.js";

// Print N stage-null verified rows in JSON for handoff to a subagent.
//
// CLI:
//   npx tsx scripts/_pick-rows.ts --limit 20
//   npx tsx scripts/_pick-rows.ts --limit 200 --vc-only
//   npx tsx scripts/_pick-rows.ts --limit 200 --vc-only --out /tmp/batch.jsonl
//   npx tsx scripts/_pick-rows.ts --limit 40 --offset 80 --vc-only --out /tmp/b2.jsonl
//
// --vc-only filters to companies sourced from per-VC adapters (excludes
// exa-discovery + accelerator + aggregator sources). Per-VC sources have
// much higher Series-A/B density because they're VC-backed by definition.

const NON_VC_SOURCES = new Set([
  "exa-discovery",
  "techstars",
  "gener8tor",
  "500global",
  "thehub",
  "hn_hiring",
  "yc",
  "gregslist",
  "startups_gallery",
]);

async function main() {
  const argv = process.argv.slice(2);
  let limit = 20;
  let offset = 0;
  let vcOnly = false;
  let outPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") limit = parseInt(argv[++i], 10);
    else if (a === "--offset") offset = parseInt(argv[++i], 10);
    else if (a === "--vc-only") vcOnly = true;
    else if (a === "--out") outPath = argv[++i];
  }

  const rows = await prisma.company.findMany({
    where: {
      isVerified: true,
      stage: null,
      NOT: { tags: { hasSome: ["cc-stage-tried", "exa-stage-tried"] } },
      ...(vcOnly
        ? { source: { notIn: [...NON_VC_SOURCES] } }
        : {}),
    },
    select: { id: true, name: true, domain: true, website: true, description: true, source: true },
    take: limit,
    skip: offset,
    orderBy: { id: "asc" },
  });

  const lines = rows.map((r) => {
    const desc = (r.description ?? "").slice(0, 200).replace(/\s+/g, " ");
    return JSON.stringify({ id: r.id, name: r.name, domain: r.domain, website: r.website, source: r.source, descSnippet: desc });
  });

  if (outPath) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, lines.join("\n") + "\n");
    console.error(`wrote ${lines.length} rows → ${outPath}`);
  } else {
    for (const l of lines) console.log(l);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
