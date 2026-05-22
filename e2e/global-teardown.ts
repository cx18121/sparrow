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

  const { data, error: listErr } = await admin.auth.admin.listUsers()
  if (listErr) {
    const detail = listErr.message || JSON.stringify(listErr, null, 2) || String(listErr)
    throw new Error(
      `[global-teardown] Could not list users: ${detail}\n` +
      `Hint: admin.* calls need the legacy SERVICE_ROLE_KEY JWT, not the new ` +
      `sb_secret_* publishable/secret keys.`
    )
  }

  const user = data?.users?.find(u => u.email === 'e2e@sparrow.test')
  if (user) {
    console.log('[global-teardown] Deleting e2e test user...')
    const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id)
    if (deleteErr) throw new Error(`[global-teardown] Failed to delete e2e test user: ${deleteErr.message}`)
  }

  console.log('[global-teardown] Teardown complete.')
}
