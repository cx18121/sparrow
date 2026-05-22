import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env.test.local') })

const LOCAL_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_KEY ?? ''

export default async function globalTeardown() {
  const admin = createClient(LOCAL_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Same retry-with-backoff as global-setup. Teardown runs after Playwright
  // completes; auth should be stable, but cheap insurance.
  let data: { users?: Array<{ id: string; email?: string }> } | null = null
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await admin.auth.admin.listUsers()
    if (!res.error) { data = res.data; lastErr = null; break }
    lastErr = res.error
    await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
  }
  if (lastErr) {
    const detail = (lastErr as any).message || JSON.stringify(lastErr, null, 2) || String(lastErr)
    throw new Error(`[global-teardown] Could not list users after 6 retries: ${detail}`)
  }

  const user = data?.users?.find(u => u.email === 'e2e@sparrow.test')
  if (user) {
    console.log('[global-teardown] Deleting e2e test user...')
    const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id)
    if (deleteErr) throw new Error(`[global-teardown] Failed to delete e2e test user: ${deleteErr.message}`)
  }

  console.log('[global-teardown] Teardown complete.')
}
