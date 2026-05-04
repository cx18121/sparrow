import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Either the singleton client or the transactional client passed by
// `prisma.$transaction(async tx => ...)`. Helpers that need to participate
// in a caller's transaction take a `Db` arg that defaults to the singleton.
export type Db = PrismaClient | Prisma.TransactionClient;

// Serverless-safe singleton: cache the client across warm invocations
// in the same Lambda container via globalThis. Each cold start creates
// a new client; node-postgres (via PrismaPg) handles its own pool.
//
// Use DATABASE_URL (the Supabase pgbouncer pooler on :6543) in serverless
// so we don't exhaust the direct Postgres connection limit.
const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
