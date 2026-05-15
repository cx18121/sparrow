#!/usr/bin/env node
// Apply prisma/schema.prisma to either the local Supabase DB or production.
//   `npm run db:push:local`     — fast `db push` for local exploration
//   `npm run db:migrate:create` — `prisma migrate dev --name X` to author a
//                                 new versioned migration file (run locally,
//                                 commit the resulting prisma/migrations/...)
//   `npm run db:migrate:deploy` — apply pending migrations to PROD
//
// Prod schema changes only flow through migrate-deploy. `db push --to-prod`
// was retired on 2026-05-15 — declarative push has no history, no review
// surface, and no rollback path. Migrations live in prisma/migrations/ and
// the _prisma_migrations table tracks what's been applied where.

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const target = process.argv[2]

if (target === 'local') {
  // Always use the well-known local URL — independent of whatever .env says.
  execSync(`npx prisma db push --url ${LOCAL_URL}`, { stdio: 'inherit' })
  process.exit(0)
}

if (target === 'migrate-create') {
  const name = process.argv[3]
  if (!name) {
    console.error('Usage: npm run db:migrate:create -- <migration_name>')
    console.error('Example: npm run db:migrate:create -- add_user_preferences')
    process.exit(1)
  }
  // migrate dev runs against the local Supabase DB — Prisma needs a shadow
  // DB to compute the diff, so this only works when supabase is running.
  execSync(`npx prisma migrate dev --name ${name}`, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: LOCAL_URL, DIRECT_URL: LOCAL_URL },
  })
  process.exit(0)
}

if (target === 'migrate-deploy') {
  // prisma.config.ts reads DIRECT_URL from .env / .env.local.
  const directUrl = process.env.DIRECT_URL ?? loadEnvVar('DIRECT_URL')
  if (!directUrl) {
    console.error('DIRECT_URL is not set. Cannot deploy migrations.')
    process.exit(1)
  }
  if (directUrl.includes('127.0.0.1') || directUrl.includes('localhost')) {
    console.error(`Refusing to deploy: DIRECT_URL points at a local host (${maskUrl(directUrl)}).`)
    console.error('Use \`npm run db:migrate:create\` to author the migration locally first.')
    process.exit(1)
  }

  console.log('About to apply pending migrations to PRODUCTION:')
  console.log(`  ${maskUrl(directUrl)}`)
  console.log('')
  console.log('Migration files in prisma/migrations/ that have not been recorded')
  console.log('in the _prisma_migrations table will run against the live DB.')
  console.log('')
  const rl = readline.createInterface({ input: stdin, output: stdout })
  const answer = await rl.question('Type "deploy to prod" to confirm: ')
  rl.close()
  if (answer.trim() !== 'deploy to prod') {
    console.log('Aborted.')
    process.exit(0)
  }
  execSync(`npx prisma migrate deploy`, { stdio: 'inherit' })
  process.exit(0)
}

if (target === 'prod') {
  console.error('db:push:prod was retired. Prod schema changes go through migrations:')
  console.error('  1) npm run db:migrate:create -- <name>   (creates prisma/migrations/.../migration.sql)')
  console.error('  2) commit the generated migration file')
  console.error('  3) npm run db:migrate:deploy             (applies it to prod)')
  process.exit(1)
}

console.error('Usage: node scripts/db-push.mjs <local|migrate-create|migrate-deploy>')
process.exit(1)

function maskUrl(url) {
  return url.replace(/:([^@/]+)@/, ':****@')
}

function loadEnvVar(name) {
  // Minimal .env reader — Prisma loads them via prisma.config.ts at run time
  // but we need the value before that to decide whether to confirm. Kept
  // lightweight so we don't pull in the dotenv package just for this.
  for (const file of ['.env.local', '.env']) {
    try {
      const text = readFileSync(file, 'utf8')
      const line = text.split('\n').find(l => l.trim().startsWith(`${name}=`))
      if (line) {
        const value = line.slice(line.indexOf('=') + 1).trim()
        return value.replace(/^"|"$/g, '')
      }
    } catch {}
  }
  return null
}
