import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isDemo } from '../lib/supabase'
import { connectGoogle as startGoogleConnect, fetchProfile, saveProfile, setApiAccessToken, setApiUserId } from '../lib/api'

const AuthContext = createContext(null)

// Sign-in-with-Google requests both identity AND gmail.send so the consent
// screen explicitly covers sending permission. Two paths feed into the
// encrypted google_refresh_token:
//   1. Supabase emits provider_refresh_token when Google returns one. We
//      request prompt=consent so recreated accounts get a fresh grant.
//   2. If Supabase still has none, we automatically redirect through the
//      server-side flow at /api/google/connect, which also uses
//      prompt=consent + access_type=offline to reliably obtain one.
// The Settings Connect button stays as the manual reconnect path for
// password-signed-up users and for revoked / expired tokens.
const GOOGLE_AUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ')

// Marker stored just before initiating sign-in so the post-callback handler
// knows the previous redirect was a Google sign-in (not, say, a password
// sign-in via the same AuthScreen). Cleared after the post-sign-in Gmail
// reconciliation runs once.
const GMAIL_RECONCILE_KEY = 'cf_gmail_reconcile_pending'

function applySessionToApiClient(session) {
  setApiUserId(session?.user?.id ?? null)
  setApiAccessToken(session?.access_token ?? null)
}

// Per-tab guard so SIGNED_IN + INITIAL_SESSION + getSession don't all fire
// the reconciliation path concurrently after a single Google round-trip.
let gmailReconcileInFlight: Promise<void> | null = null

// Run after Supabase emits a session for a Google sign-in. Persists the
// refresh token Supabase exposed (first-grant case) or — when Supabase
// has none — auto-redirects through the server-side /api/google/connect
// flow which forces consent and reliably issues one. Skipped silently
// when the user already has a stored token or didn't sign in via Google
// (password sign-in clears the marker before calling).
async function reconcileGmailGrant(session: any): Promise<void> {
  if (typeof window === 'undefined') return
  let pending = false
  try { pending = sessionStorage.getItem(GMAIL_RECONCILE_KEY) === '1' } catch { /* sessionStorage may be blocked */ }

  // First-grant case: Supabase surfaces provider_refresh_token in the
  // session. Persist it directly, no redirect needed. Only consider this
  // when the marker is set so we don't paw at unrelated sessions.
  const refreshToken: string | null = session?.provider_refresh_token ?? null
  if (refreshToken && pending) {
    try { sessionStorage.removeItem(GMAIL_RECONCILE_KEY) } catch {}
    try { await saveProfile({ googleRefreshToken: refreshToken }) } catch { /* fall through to redirect path on next tick */ }
    return
  }

  // Without the marker we don't reconcile — saves a /api/profile round trip
  // for token refreshes and password sign-ins.
  if (!pending) return

  // Defensive: only proceed if the session is actually a Google identity.
  // A stale marker from a previous flow shouldn't redirect a password user
  // to the Google consent screen.
  const provider = session?.user?.app_metadata?.provider
  const identities: any[] = session?.user?.identities ?? []
  const isGoogle = provider === 'google' || identities.some(i => i?.provider === 'google')
  if (!isGoogle) {
    try { sessionStorage.removeItem(GMAIL_RECONCILE_KEY) } catch {}
    return
  }

  if (gmailReconcileInFlight) return gmailReconcileInFlight
  gmailReconcileInFlight = (async () => {
    try {
      // Supabase didn't emit a refresh token (returning user — Google only
      // issues one on first grant unless we force consent). Check the
      // profile: if the user already has one stored, we're done.
      const { profile } = await fetchProfile()
      if (profile?.hasGoogleRefreshToken) {
        try { sessionStorage.removeItem(GMAIL_RECONCILE_KEY) } catch {}
        return
      }
      // No stored token. Bounce through the server flow which uses
      // prompt=consent + access_type=offline to force Google to mint one.
      const returnTo = `${window.location.pathname}${window.location.search}`
      const res = await startGoogleConnect(returnTo)
      try { sessionStorage.removeItem(GMAIL_RECONCILE_KEY) } catch {}
      if (res?.url) window.location.assign(res.url)
    } catch {
      // Reconciliation is best-effort. The Settings Connect button remains
      // available as a manual reconnect path if this silently fails.
      try { sessionStorage.removeItem(GMAIL_RECONCILE_KEY) } catch {}
    } finally {
      gmailReconcileInFlight = null
    }
  })()
  return gmailReconcileInFlight
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // In demo mode, check localStorage for a persisted demo user
    if (isDemo) {
      const stored = localStorage.getItem('cf_demo_user')
      if (stored) {
        const demoUser = JSON.parse(stored)
        setUser(demoUser)
        setApiUserId(demoUser.id)
      }
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      // Re-check: onAuthStateChange may have fired SIGNED_OUT before this resolves.
      const { data: { session: current } } = await supabase.auth.getSession()
      if (!current) {
        setUser(null)
        setLoading(false)
        return
      }
      if (session) {
        applySessionToApiClient(session)
        reconcileGmailGrant(session).catch(() => {})
      }
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null)
        applySessionToApiClient(null)
        return
      }

      if (session) {
        applySessionToApiClient(session)
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          reconcileGmailGrant(session).catch(() => {})
        }
        // Use functional update to preserve referential stability on TOKEN_REFRESHED —
        // if the user ID hasn't changed, keep the existing object so downstream
        // useEffect([user]) deps don't fire on every token refresh.
        setUser(prev => prev?.id === session.user.id ? prev : session.user)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async ({ email, password }) => {
    if (isDemo) {
      const demoId = localStorage.getItem('cf_demo_id') || crypto.randomUUID()
      localStorage.setItem('cf_demo_id', demoId)
      const demoUser = { id: demoId, email, user_metadata: { full_name: email.split('@')[0], avatar_url: null } }
      setUser(demoUser)
      localStorage.setItem('cf_demo_user', JSON.stringify(demoUser))
      setApiUserId(demoUser.id)
      return { error: null }
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && data.session) {
      applySessionToApiClient(data.session)
      setUser(data.user)
    }
    return { error }
  }

  const signUp = async ({ email, password, fullName }) => {
    if (isDemo) {
      const demoId = localStorage.getItem('cf_demo_id') || crypto.randomUUID()
      localStorage.setItem('cf_demo_id', demoId)
      const demoUser = { id: demoId, email, user_metadata: { full_name: fullName, avatar_url: null } }
      setUser(demoUser)
      localStorage.setItem('cf_demo_user', JSON.stringify(demoUser))
      setApiUserId(demoUser.id)
      return { error: null }
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (!error && data?.session) {
      applySessionToApiClient(data.session)
      setUser(data.user)
    }
    return { error }
  }

  const signInWithGoogle = async () => {
    if (isDemo) {
      return { error: { message: 'Google OAuth requires Supabase — configure VITE_SUPABASE_URL' } }
    }

    // signInWithGoogle is only called from AuthScreen (user is always signed out).
    // Always use signInWithOAuth — never linkIdentity, which requires an active session
    // and would fail (or silently mislink accounts) if a stale session lingers after sign-out.
    //
    // Scopes include gmail.send so the consent screen captures Gmail
    // authorization in the same step as identity. prompt=consent is deliberate:
    // deleting a Sparrow account should not let a recreated account silently
    // inherit a previous Google grant.
    try { sessionStorage.setItem(GMAIL_RECONCILE_KEY, '1') } catch {}
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: GOOGLE_AUTH_SCOPES,
        queryParams: {
          // access_type=offline asks Google to issue a refresh token.
          access_type: 'offline',
          include_granted_scopes: 'true',
          prompt: 'consent',
        },
      },
    })
    if (!error && data?.session) {
      applySessionToApiClient(data.session)
    }
    return { error }
  }

  const connectGoogle = async () => {
    if (isDemo) {
      return { error: { message: 'Google OAuth requires Supabase — configure VITE_SUPABASE_URL' } }
    }

    try {
      const returnTo = `${window.location.pathname}${window.location.search}`
      const res = await startGoogleConnect(returnTo)
      if (res?.url) window.location.assign(res.url)
      return { error: null }
    } catch (err) {
      return { error: { message: err.message || 'Google connection could not start.' } }
    }
  }

  const signOut = async () => {
    // Clear immediately — don't wait for onAuthStateChange to avoid stale UI.
    setUser(null)
    applySessionToApiClient(null)
    // Clear cross-user session caches so a new sign-in starts fresh.
    try { sessionStorage.removeItem('cf_discover_state') } catch {}
    try { sessionStorage.removeItem(GMAIL_RECONCILE_KEY) } catch {}

    if (isDemo) {
      // Clear both demo identity keys so the next "sign up" doesn't inherit
      // the previous demo user's ID and bleed state across personas.
      localStorage.removeItem('cf_demo_user')
      localStorage.removeItem('cf_demo_id')
      return
    }
    await supabase.auth.signOut()
  }

  const value = { user, loading, signIn, signUp, signInWithGoogle, connectGoogle, signOut, isDemo }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
