import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isDemo } from '../lib/supabase'
import { connectGoogle as startGoogleConnect, fetchProfile, saveProfile, setApiAccessToken, setApiUserId } from '../lib/api'

const AuthContext = createContext(null)

// Sign-in-with-Google: identity scopes only. Gmail sending requires
// access_type=offline + prompt=consent to reliably obtain a refresh token,
// and Supabase's session.provider_refresh_token is not exposed in every
// project configuration / OAuth flow combination — we've observed cases
// where it is undefined even when Google returned a refresh token.
//
// To remove that dependency, gmail.send is requested via the server-side
// flow at /api/google/connect immediately after Supabase sign-in, which
// exchanges Google's code with our own OAuth client and stores the
// refresh token deterministically. Google's incremental authorization
// (include_granted_scopes=true) means the user sees a *second*, scope-
// specific consent screen ("Send emails on your behalf") rather than two
// identical "everything" screens.
const GOOGLE_AUTH_SCOPES = [
  'openid',
  'email',
  'profile',
].join(' ')

// Marker stored just before initiating sign-in so the post-callback handler
// knows the previous redirect was a Google sign-in (not, say, a password
// sign-in via the same AuthScreen). Cleared after the post-sign-in Gmail
// reconciliation runs once.
const GMAIL_RECONCILE_KEY = 'cf_gmail_reconcile_pending'
const PROFILE_UPDATED_EVENT = 'sparrow:profile-updated'
// Fired when the auto-reconcile path fails. Settings listens for it so the
// user sees the real error (e.g., "/api/google/connect not reachable") instead
// of a silent "Not connected" + amber dot with no explanation.
const RECONCILE_FAILED_EVENT = 'sparrow:gmail-reconcile-failed'

function dispatchReconcileFailure(err: unknown): void {
  if (typeof window === 'undefined') return
  const message = err instanceof Error ? err.message : String(err ?? 'Gmail auto-connect failed.')
  try {
    window.dispatchEvent(new CustomEvent(RECONCILE_FAILED_EVENT, { detail: { message } }))
  } catch {}
}

function applySessionToApiClient(session) {
  setApiUserId(session?.user?.id ?? null)
  setApiAccessToken(session?.access_token ?? null)
}

// Per-tab guard so SIGNED_IN + INITIAL_SESSION + getSession don't all fire
// the reconciliation path concurrently after a single Google round-trip.
let gmailReconcileInFlight: Promise<void> | null = null

// Run after Supabase emits a session for a Google sign-in. ALWAYS routes
// through the server-side /api/google/connect flow, which exchanges
// Google's code with our own OAuth client (using prompt=consent +
// access_type=offline + include_granted_scopes=true) and stores the
// resulting refresh_token in user_profiles.google_refresh_token_encrypted.
//
// Why not use session.provider_refresh_token? It's unreliable. In some
// Supabase project configurations / OAuth flow combinations (PKCE vs
// implicit, project secret config), provider_refresh_token is undefined
// even when Google did return a refresh_token to Supabase's GoTrue
// server. Rather than guessing, the server-side flow is deterministic.
//
// UX cost: Google shows two consent screens on first sign-in (identity,
// then gmail.send). With include_granted_scopes the second is scope-
// specific ("Send emails on your behalf") rather than a duplicate of the
// first. After the first sign-in, fast-skip below avoids the second hop.
async function reconcileGmailGrant(session: any): Promise<void> {
  if (typeof window === 'undefined') return
  let pending = false
  try { pending = sessionStorage.getItem(GMAIL_RECONCILE_KEY) === '1' } catch { /* sessionStorage may be blocked */ }
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
      // Fast-skip: if the user already has a stored token (returning user
      // who connected previously, or a parallel onAuthStateChange event
      // already completed the flow), nothing to do.
      const { profile } = await fetchProfile()
      if (profile?.hasGoogleRefreshToken) {
        try { sessionStorage.removeItem(GMAIL_RECONCILE_KEY) } catch {}
        return
      }
      const returnTo = `${window.location.pathname}${window.location.search}`
      const res = await startGoogleConnect(returnTo)
      if (res?.url) {
        // Clear the marker only once navigation is committed. If the
        // server returned no URL we keep the marker so the next session
        // event can retry rather than dropping the user silently.
        try { sessionStorage.removeItem(GMAIL_RECONCILE_KEY) } catch {}
        window.location.assign(res.url)
      } else {
        dispatchReconcileFailure(new Error('Gmail connection started but the server did not return a URL.'))
      }
    } catch (err) {
      // Surface the failure to the UI. Keep the marker so subsequent session
      // events (token refresh, page focus) can retry — safer than silently
      // leaving the user "Not connected" with no explanation.
      dispatchReconcileFailure(err)
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

    supabase.auth.getSession().then(async () => {
      // Re-check: onAuthStateChange may have fired SIGNED_OUT before this resolves.
      const { data: { session: current } } = await supabase.auth.getSession()
      if (!current) {
        setUser(null)
        setLoading(false)
        return
      }
      applySessionToApiClient(current)
      reconcileGmailGrant(current).catch(() => {})
      setUser(current.user)
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
    // Identity scopes only — gmail.send is requested separately by
    // reconcileGmailGrant via /api/google/connect after sign-in completes.
    // The marker tells reconcileGmailGrant that this session originated from
    // a Google sign-in and should trigger the gmail.send consent flow.
    try { sessionStorage.setItem(GMAIL_RECONCILE_KEY, '1') } catch {}
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: GOOGLE_AUTH_SCOPES,
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
