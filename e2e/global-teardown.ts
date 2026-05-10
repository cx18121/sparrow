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

  const { data } = await admin.auth.admin.listUsers()
  const user = data?.users?.find(u => u.email === 'e2e@sparrow.test')

  if (user) {
    console.log('[global-teardown] Deleting e2e test user...')
    await admin.auth.admin.deleteUser(user.id)
  }

  console.log('[global-teardown] Teardown complete.')
}
