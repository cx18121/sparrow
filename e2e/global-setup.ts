import { execSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Load .env.test.local if it exists; otherwise auto-derive keys from `supabase status`.
const envFile = resolve(PROJECT_ROOT, '.env.test.local')
if (existsSync(envFile)) {
  config({ path: envFile })
} else {
  // Auto-populate from `supabase status` so developers don't need to copy keys.
  try {
    const status = execSync('supabase status --output json 2>/dev/null', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    })
    const json = JSON.parse(status)
    process.env.E2E_SUPABASE_URL = json.API_URL ?? 'http://127.0.0.1:54321'
    process.env.E2E_SUPABASE_ANON_KEY = json.PUBLISHABLE_KEY ?? json.ANON_KEY ?? ''
    // Prefer SERVICE_ROLE_KEY (legacy service-role JWT) over SECRET_KEY (new
    // opaque sb_secret_* format). supabase-js admin.* calls expect the JWT.
    process.env.E2E_SUPABASE_SERVICE_KEY = json.SERVICE_ROLE_KEY ?? json.SECRET_KEY ?? ''
    process.env.E2E_DB_URL = json.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  } catch {
    // Supabase not running yet — globalSetup will start it and keys will be set after.
  }
}

const LOCAL_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
let SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_KEY ?? ''

export default async function globalSetup() {
  // 1. Check supabase is running; start if not.
  let supabaseRunning = false
  try {
    const r = await fetch(`${LOCAL_URL}/auth/v1/health`)
    supabaseRunning = r.status < 500
  } catch {
    supabaseRunning = false
  }

  if (!supabaseRunning) {
    console.log('[global-setup] Starting local Supabase...')
    execSync('supabase start', { stdio: 'inherit', cwd: PROJECT_ROOT })
  } else {
    console.log('[global-setup] Local Supabase already running.')
  }

  // After start, if keys weren't loaded from file, derive them now.
  if (!SERVICE_KEY) {
    try {
      const status = execSync('supabase status --output json 2>/dev/null', {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
      })
      const json = JSON.parse(status)
      process.env.E2E_SUPABASE_URL = json.API_URL ?? LOCAL_URL
      process.env.E2E_SUPABASE_ANON_KEY = json.PUBLISHABLE_KEY ?? json.ANON_KEY ?? ''
      // Same SERVICE_ROLE_KEY-first preference as the top-level loader.
      process.env.E2E_SUPABASE_SERVICE_KEY = json.SERVICE_ROLE_KEY ?? json.SECRET_KEY ?? ''
      SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_KEY ?? ''
    } catch {
      throw new Error('[global-setup] Could not read Supabase keys. Run `supabase start` first.')
    }
  }

  // 2. Reset DB only when explicitly requested or on CI.
  const shouldReset = process.env.SUPABASE_RESET === '1' || !!process.env.CI
  if (shouldReset) {
    console.log('[global-setup] Resetting database...')
    execSync('supabase db reset --no-seed', { stdio: 'inherit', cwd: PROJECT_ROOT })
  } else {
    console.log('[global-setup] Skipping db reset (SUPABASE_RESET=1 to force).')
  }

  // 3. Push Prisma-managed tables.
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

  // 4. Ensure e2e test user exists — must run after any DB reset so the auth
  //    row isn't wiped before tests can sign in.
  const adminUrl = process.env.E2E_SUPABASE_URL ?? LOCAL_URL
  const adminKey = process.env.E2E_SUPABASE_SERVICE_KEY ?? SERVICE_KEY
  const admin = createClient(adminUrl, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: existing, error: listErr } = await admin.auth.admin.listUsers()
  if (listErr) {
    // Stringify the full error — message can be undefined when supabase-js
    // wraps a low-level fetch failure or a new opaque-key auth error.
    const detail = listErr.message || JSON.stringify(listErr, null, 2) || String(listErr)
    throw new Error(
      `[global-setup] Could not list users: ${detail}\n` +
      `Hint: admin.* calls need the legacy SERVICE_ROLE_KEY JWT, not the new ` +
      `sb_secret_* publishable/secret keys.`
    )
  }

  const alreadyExists = existing?.users?.some(u => u.email === 'e2e@sparrow.test')
  if (!alreadyExists) {
    console.log('[global-setup] Creating e2e test user...')
    const { error } = await admin.auth.admin.createUser({
      email: 'e2e@sparrow.test',
      password: 'SparrowE2E2024!',
      email_confirm: true,
      user_metadata: { full_name: 'E2E Test User' },
    })
    if (error) throw new Error(`[global-setup] Failed to create e2e test user: ${error.message}`)
  } else {
    console.log('[global-setup] E2E test user already exists.')
  }

  console.log('[global-setup] Setup complete.')
}
