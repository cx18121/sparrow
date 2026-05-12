import "dotenv/config";
import { prisma } from "./_lib/prisma.js";

async function main() {
  const examples = [
    "openai.com",
    "stripe.com",
    "figma.com",
    "ramp.com",
    "anthropic.com",
    "replit.com",
    "datadoghq.com",
    "scale.com",
    "discord.com",
    "shopify.com",
  ];
  console.log("Investor tag accumulation check");
  console.log("================================");
  for (const d of examples) {
    const c = await prisma.company.findUnique({
      where: { domain: d },
      select: { name: true, domain: true, source: true, tags: true },
    });
    if (!c) {
      console.log(`  ${d.padEnd(20)} (not in DB)`);
      continue;
    }
    const investors = c.tags.filter((t) => t.startsWith("investor:"));
    const signals = c.tags.filter((t) => t.startsWith("signal:"));
    console.log(
      `  ${c.domain.padEnd(20)} source=${c.source.padEnd(20)} investors=${investors.length}: ${investors.join(", ")}`
    );
    if (signals.length) console.log(`  ${"".padEnd(20)} signals: ${signals.join(", ")}`);
  }
  // Also: how many companies have >1 investor tag?
  const all = await prisma.company.findMany({
    where: { isVerified: true },
    select: { tags: true },
  });
  let multi = 0;
  let solo = 0;
  let none = 0;
  let max = 0;
  for (const c of all) {
    const n = c.tags.filter((t) => t.startsWith("investor:")).length;
    if (n === 0) none++;
    else if (n === 1) solo++;
    else multi++;
    if (n > max) max = n;
  }
  console.log("");
  console.log(
    `Among ${all.length} verified rows: ${none} no-investor-tag, ${solo} single-investor, ${multi} multi-investor (max ${max} per row)`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
