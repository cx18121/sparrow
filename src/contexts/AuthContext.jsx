import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isDemo } from '../lib/supabase'
import { setApiAccessToken, setApiUserId, saveProfile } from '../lib/api'

const AuthContext = createContext(null)

// Google OAuth scopes — gmail.send is required to send mail on the
// user's behalf; offline access is required for Google to issue a
// refresh token (combined with access_type=offline + prompt=consent).
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ')

const persistedRefreshTokens = new Set()

async function persistGoogleRefreshToken(session) {
  const token = session?.provider_refresh_token
  if (!token || persistedRefreshTokens.has(token)) return
  persistedRefreshTokens.add(token)
  try {
    await saveProfile({ googleRefreshToken: token })
  } catch (err) {
    persistedRefreshTokens.delete(token)
    console.error('Failed to persist Google refresh token', err)
  }
}

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

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
      if (session) {
        applySessionToApiClient(session)
        persistGoogleRefreshToken(session)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // onAuthStateChange fires synchronously for INITIAL_SESSION before getSession resolves,
      // and again for SIGNED_IN/TOKEN_REFRESHED. Only act on actual auth changes.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        setUser(session?.user ?? null)
        if (session) {
          applySessionToApiClient(session)
          persistGoogleRefreshToken(session)
        }
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async ({ email, password }) => {
    if (isDemo) {
      const demoUser = { id: 'demo-user', email, user_metadata: { full_name: email.split('@')[0], avatar_url: null } }
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
      const demoUser = { id: 'demo-user', email, user_metadata: { full_name: fullName, avatar_url: null } }
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
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: GOOGLE_SCOPES,
        // access_type=offline + prompt=consent forces Google to issue a
        // refresh token even on repeat sign-ins, so we can send mail
        // server-side without keeping the user on the page.
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    })
    if (!error && data?.session) {
      applySessionToApiClient(data.session)
    }
    return { error }
  }

  const signOut = async () => {
    if (isDemo) {
      localStorage.removeItem('cf_demo_user')
      setUser(null)
      setApiUserId(null)
      return
    }
    await supabase.auth.signOut()
    setApiUserId(null)
  }

  const value = { user, loading, signIn, signUp, signInWithGoogle, signOut, isDemo }

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
