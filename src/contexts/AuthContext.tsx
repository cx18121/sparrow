import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { connectGoogle as startGoogleConnect, setApiAccessToken, setApiUserId } from '../lib/api'
import { clearLeadDiscoveryPrefetch } from '../lib/leadDiscoveryPrefetch'

const AuthContext = createContext(null)

// Sign-in-with-Google is identity only. Gmail send permission is requested
// explicitly from onboarding or Settings via /api/google/connect.
const GOOGLE_AUTH_SCOPES = [
  'openid',
  'email',
  'profile',
].join(' ')

function applySessionToApiClient(session) {
  setApiUserId(session?.user?.id ?? null)
  setApiAccessToken(session?.access_token ?? null)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async () => {
      // Re-check: onAuthStateChange may have fired SIGNED_OUT before this resolves.
      const { data: { session: current } } = await supabase.auth.getSession()
      if (!current) {
        setUser(null)
        setLoading(false)
        return
      }
      applySessionToApiClient(current)
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
        // Use functional update to preserve referential stability on TOKEN_REFRESHED —
        // if the user ID hasn't changed, keep the existing object so downstream
        // useEffect([user]) deps don't fire on every token refresh.
        setUser(prev => prev?.id === session.user.id ? prev : session.user)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && data.session) {
      applySessionToApiClient(data.session)
      setUser(data.user)
    }
    return { error }
  }

  const signUp = async ({ email, password, fullName }) => {
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
    // signInWithGoogle is only called from AuthScreen. It requests identity
    // scopes only; Gmail send permission is a separate explicit action.
    // signInWithOAuth returns a redirect URL — the session arrives later
    // via onAuthStateChange, so there's no session to apply synchronously.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: GOOGLE_AUTH_SCOPES,
      },
    })
    return { error }
  }

  const connectGoogle = async () => {
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
    clearLeadDiscoveryPrefetch()
    await supabase.auth.signOut()
  }

  const value = { user, loading, signIn, signUp, signInWithGoogle, connectGoogle, signOut }

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
