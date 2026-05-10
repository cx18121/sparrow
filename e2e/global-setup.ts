import { execSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
config({ path: resolve(PROJECT_ROOT, '.env.test.local') })

const LOCAL_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_KEY ?? ''

export default async function globalSetup() {
  // 1. Check supabase is running; start if not.
  let supabaseRunning = false
  try {
    const r = await fetch(`${LOCAL_URL}/health`)
    supabaseRunning = r.ok
  } catch {
    supabaseRunning = false
  }

  if (!supabaseRunning) {
    console.log('[global-setup] Starting local Supabase...')
    execSync('supabase start', { stdio: 'inherit', cwd: PROJECT_ROOT })
  } else {
    console.log('[global-setup] Local Supabase already running.')
  }

  // 2. Reset DB so migrations (schema.sql) are applied fresh.
  console.log('[global-setup] Resetting database...')
  execSync('supabase db reset --no-seed', { stdio: 'inherit', cwd: PROJECT_ROOT })

  // 3. Push Prisma-managed tables (Campaign, Template, UserLead, etc.).
  console.log('[global-setup] Pushing Prisma schema...')
  execSync('npx prisma db push --url postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      DIRECT_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    },
  })

  // 4. Create e2e test user if it doesn't already exist.
  const admin = createClient(LOCAL_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: existing } = await admin.auth.admin.listUsers()
  const alreadyExists = existing?.users?.some(u => u.email === 'e2e@sparrow.test')

  if (!alreadyExists) {
    console.log('[global-setup] Creating e2e test user...')
    const { error } = await admin.auth.admin.createUser({
      email: 'e2e@sparrow.test',
      password: 'SparrowE2E2024!',
      email_confirm: true,
      user_metadata: { full_name: 'E2E Test User' },
    })
    if (error) {
      throw new Error(`Failed to create e2e test user: ${error.message}`)
    }
  } else {
    console.log('[global-setup] E2E test user already exists.')
  }

  console.log('[global-setup] Setup complete.')
}
