import { resolve } from "path"
import { fileURLToPath } from "url"
import { config as loadEnv } from "dotenv"

const __dirname = resolve(fileURLToPath(import.meta.url), "../..")
loadEnv({ path: resolve(__dirname, ".env.local") })
loadEnv({ path: resolve(__dirname, ".env") })

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error("DIRECT_URL not set")

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function migrate() {
  try {
    await prisma.$executeRaw`ALTER TABLE "UserLead" ADD COLUMN IF NOT EXISTS "apolloPersonId" TEXT`
    console.log("✅ Migration successful: apolloPersonId column added")
  } catch (e: any) {
    console.error("❌ Migration failed:", e.message)
  } finally {
    await prisma.$disconnect()
  }
}

migrate()
