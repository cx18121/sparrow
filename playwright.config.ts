import { defineConfig, devices } from '@playwright/test'
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load local e2e env vars (.env.test.local) — run `supabase status` to get values.
// Copy .env.test.example → .env.test.local and fill in your local keys.
config({ path: resolve(__dirname, '.env.test.local') })

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY     = process.env.E2E_SUPABASE_ANON_KEY ?? ''
const SERVICE_KEY  = process.env.E2E_SUPABASE_SERVICE_KEY ?? ''
const DB_URL       = process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

if (!ANON_KEY || !SERVICE_KEY) {
  console.warn('[playwright] E2E_SUPABASE_ANON_KEY / E2E_SUPABASE_SERVICE_KEY not set. Copy .env.test.example → .env.test.local')
}

// Tests run against a real local Supabase stack (Docker).
// Auth uses real signInWithPassword; internal API routes hit real Postgres.
// Only external services (Apollo, Claude, Gmail, Google OAuth) are mocked.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // Run tests serially to avoid inter-test data collisions.
  // Each test creates its own data and cleans up in afterEach.
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
      // Vite frontend — pass local Supabase env vars so the client connects
      // to the local instance instead of production.
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
      // Local API server — connected to local Supabase + Postgres.
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
