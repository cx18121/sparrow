import { defineConfig, devices } from '@playwright/test'

// Smoke tests run against a local Vite dev server in demo mode (no Supabase).
// API calls are mocked per-test via page.route(), so no backend is required.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Demo mode kicks in when VITE_SUPABASE_URL is missing or default.
    command: 'VITE_SUPABASE_URL= npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
