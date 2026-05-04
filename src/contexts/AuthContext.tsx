import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isDemo } from '../lib/supabase'
import { connectGoogle as startGoogleConnect, setApiAccessToken, setApiUserId } from '../lib/api'

const AuthContext = createContext(null)

// Sign-in-with-Google grants identity ONLY. Gmail send permission is its
// own concern, captured exclusively through the server-side OAuth flow at
// /api/google/connect → /api/google/callback. There used to be a second
// path here that read session.provider_refresh_token and persisted it, plus
// a cf_wants_gmail flag that triggered an automatic redirect through the
// server flow when Supabase failed to emit a refresh token. Both have been
// removed: Supabase's behavior on subsequent sign-ins is unreliable, the
// fallback ran inconsistently, and the dual flow led to silent drift between
// "I signed in with Google" and "I can actually send mail." The Settings
// "Connect" button is now the single, explicit, observable place where
// Gmail capture happens.
const GOOGLE_IDENTITY_SCOPES = ['openid', 'email', 'profile'].join(' ')

function applySessionToApiClient(session) {
  setApiUserId(session?.user?.id ?? null)
  setApiAccessToken(session?.access_token ?? null)
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
    // Identity scopes only. Gmail send permission is captured separately
    // through Settings → Connect, not bundled into sign-in. See the comment
    // on GOOGLE_IDENTITY_SCOPES at the top of the file.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: GOOGLE_IDENTITY_SCOPES,
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
