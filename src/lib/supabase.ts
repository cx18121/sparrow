import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// If env vars are not set, create a mock client for demo mode
export const isDemo = !supabaseUrl || supabaseUrl === 'https://your-project.supabase.co'

export const supabase = isDemo
  ? createMockClient()
  : createClient(supabaseUrl, supabaseAnonKey)

function createMockClient() {
  // Minimal mock so imports don't break in demo mode
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: (cb) => {
        cb('SIGNED_OUT', null)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithPassword: async () => ({ data: {}, error: { message: 'Demo mode — set VITE_SUPABASE_URL to enable auth' } }),
      signInWithOAuth: async () => ({ data: {}, error: { message: 'Demo mode — set VITE_SUPABASE_URL to enable OAuth' } }),
      signUp: async () => ({ data: {}, error: { message: 'Demo mode — set VITE_SUPABASE_URL to enable sign up' } }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({
      select: () => ({ data: [], error: null }),
      insert: () => ({ data: null, error: null }),
      update: () => ({ data: null, error: null }),
      delete: () => ({ data: null, error: null }),
    }),
  }
}
