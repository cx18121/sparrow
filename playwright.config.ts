import { defineConfig, devices } from '@playwright/test'
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envFile = resolve(__dirname, '.env.test.local')

// Load .env.test.local if present; otherwise auto-derive keys from `supabase status`.
// This means `npx playwright test` works out of the box — no manual file copying needed.
if (existsSync(envFile)) {
  config({ path: envFile })
} else {
  try {
    const status = JSON.parse(
      execSync('supabase status --output json 2>/dev/null', { cwd: __dirname, encoding: 'utf8' })
    )
    process.env.E2E_SUPABASE_URL      = status.API_URL
    process.env.E2E_SUPABASE_ANON_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY
    process.env.E2E_SUPABASE_SERVICE_KEY = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY
    process.env.E2E_DB_URL            = status.DB_URL
  } catch {
    // Supabase not running yet — global-setup will start it.
  }
}

const SUPABASE_URL = process.env.E2E_SUPABASE_URL      ?? 'http://127.0.0.1:54321'
const ANON_KEY     = process.env.E2E_SUPABASE_ANON_KEY ?? ''
const SERVICE_KEY  = process.env.E2E_SUPABASE_SERVICE_KEY ?? ''
const DB_URL       = process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

// Tests run against a real local Supabase stack (Docker).
// Auth uses real signInWithPassword; internal API routes hit real Postgres.
// Only external services (Apollo, Claude, Gmail, Google OAuth) are mocked.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: [
        `VITE_SUPABASE_URL=${SUPABASE_URL}`,
        `VITE_SUPABASE_ANON_KEY=${ANON_KEY}`,
        'npm run dev',
      ].join(' '),
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: [
        `SUPABASE_URL=${SUPABASE_URL}`,
        `SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}`,
        `DATABASE_URL=${DB_URL}`,
        `DIRECT_URL=${DB_URL}`,
        'ANTHROPIC_API_KEY=fake-e2e',
        'APOLLO_API_KEY=fake-e2e',
        'npx prisma generate && npm run dev:api:local',
      ].join(' '),
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
