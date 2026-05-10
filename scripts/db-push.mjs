#!/usr/bin/env node
// Apply prisma/schema.prisma to either the local Supabase DB or production.
// Use the npm wrappers — `npm run db:push:local` or `npm run db:push:prod` —
// to make the target explicit instead of relying on whichever DATABASE_URL
// happens to be loaded from .env.

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

if (target === 'prod') {
  // prisma.config.ts reads DIRECT_URL from .env / .env.local.
  const directUrl = process.env.DIRECT_URL ?? loadEnvVar('DIRECT_URL')
  if (!directUrl) {
    console.error('DIRECT_URL is not set. Cannot push to prod.')
    process.exit(1)
  }
  if (directUrl.includes('127.0.0.1') || directUrl.includes('localhost')) {
    console.error(`Refusing to push: DIRECT_URL points at a local host (${maskUrl(directUrl)}).`)
    console.error('Use \`npm run db:push:local\` for local development.')
    process.exit(1)
  }

  console.log('About to push prisma/schema.prisma to PRODUCTION:')
  console.log(`  ${maskUrl(directUrl)}`)
  console.log('')
  console.log('This will alter the live database. Destructive changes (dropping')
  console.log('columns / tables) are blocked unless you pass --accept-data-loss.')
  console.log('')
  const rl = readline.createInterface({ input: stdin, output: stdout })
  const answer = await rl.question('Type "push to prod" to confirm: ')
  rl.close()
  if (answer.trim() !== 'push to prod') {
    console.log('Aborted.')
    process.exit(0)
  }
  const extra = process.argv.slice(3).join(' ')
  execSync(`npx prisma db push ${extra}`.trim(), { stdio: 'inherit' })
  process.exit(0)
}

console.error('Usage: node scripts/db-push.mjs <local|prod> [extra prisma flags]')
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
