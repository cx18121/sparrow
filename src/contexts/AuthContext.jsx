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
  if (!token || persistedRefreshTokens.has(token)) return false
  persistedRefreshTokens.add(token)
  try {
    await saveProfile({ googleRefreshToken: token })
    return true
  } catch (err) {
    persistedRefreshTokens.delete(token)
    console.error('Failed to persist Google refresh token', err)
    return false
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

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        applySessionToApiClient(session)
        await persistGoogleRefreshToken(session)
      }
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Provider refresh tokens are emitted only once after the OAuth redirect.
      // Persist whenever Supabase gives us a session so link/sign-in callbacks
      // cannot miss the one-time Google token.
      if (event === 'SIGNED_OUT') {
        setUser(null)
        applySessionToApiClient(null)
        return
      }

      if (session) {
        applySessionToApiClient(session)
        await persistGoogleRefreshToken(session)
        setUser(session.user)
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

    const authOptions = {
      redirectTo: window.location.href,
      scopes: GOOGLE_SCOPES,
      // access_type=offline + prompt=consent forces Google to issue a
      // refresh token even on repeat sign-ins, so we can send mail
      // server-side without keeping the user on the page.
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    }

    const { data: { session } } = await supabase.auth.getSession()
    const hasGoogleIdentity = session?.user?.identities?.some(identity => identity.provider === 'google')
    const authMethod = session && !hasGoogleIdentity
      ? supabase.auth.linkIdentity
      : supabase.auth.signInWithOAuth

    const { data, error } = await authMethod.call(supabase.auth, {
      provider: 'google',
      options: authOptions,
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
      applySessionToApiClient(null)
      return
    }
    await supabase.auth.signOut()
    applySessionToApiClient(null)
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
