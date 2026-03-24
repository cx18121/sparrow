import "dotenv/config";

/**
 * Parse CLI arguments into a key-value map.
 * Expects arguments in the form --key value.
 */
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        args[key] = value;
        i++;
      }
    }
  }
  return args;
}

const USAGE = `Usage: npx tsx scripts/manual-add.ts --domain example.com [--name "Acme Inc"] [--email ceo@example.com] [--title "CEO"] [--industry "B2B Software"] [--stage "Seed"] [--location "San Francisco"]`;

/**
 * Main CLI entrypoint for manually adding a company and optional contact.
 * Exported for testability.
 */
export async function manualAdd(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  if (!args.domain) {
    console.log(USAGE);
    process.exit(1);
  }

  // Dynamically import DB modules only after validating args (avoids DB init on usage check)
  const { prisma } = await import("./_lib/prisma.js");
  const { upsertCompany, upsertContact } = await import("./_lib/upsert.js");

  const { domain, name, email, title, industry, stage, location } = args;

  const company = await upsertCompany({
    domain,
    name: name || domain,
    industry: industry || null,
    stage: stage || null,
    location: location || null,
    source: "manual",
  });

  console.log(`Added/updated company: ${company.name} (${company.domain})`);

  if (email) {
    const contact = await upsertContact({
      companyId: company.id,
      email,
      name: name || null,
      title: title || null,
      source: "manual",
    });
    if (contact) {
      console.log(`Added/updated contact: ${email} at ${company.domain}`);
    }
  }

  await prisma.$disconnect();
}

// Run when executed directly (not when imported in tests)
if (process.argv[1]?.endsWith("manual-add.ts") || process.argv[1]?.endsWith("manual-add.js")) {
  manualAdd(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
