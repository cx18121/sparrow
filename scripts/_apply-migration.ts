// Tiny one-shot migration runner. Usage:
//   tsx scripts/_apply-migration.ts prisma/add_campaign_custom_contact.sql
// Connects with DIRECT_URL and executes the file as a single block.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL must be set");

const file = process.argv[2];
if (!file) throw new Error("Usage: tsx scripts/_apply-migration.ts <path-to-sql>");

const sql = readFileSync(resolve(process.cwd(), file), "utf8");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  console.log(`Applied ${file}.`);
} finally {
  await client.end();
}
