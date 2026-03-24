import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Use DIRECT_URL when available: the driver adapter (adapter-pg) manages its own
// connection pool via node-postgres and does not need the PgBouncer pooler URL.
// DIRECT_URL bypasses PgBouncer and avoids prepared-statement conflicts.
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export { prisma };
