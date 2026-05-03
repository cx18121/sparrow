import React, { useState } from 'react'
import { AlertCircle, Zap, Search, Send } from 'lucide-react'
import Banner from '../ui/Banner'
import { useAuth } from '../../contexts/AuthContext'

export default function AuthScreen() {
  const { signIn, signUp, signInWithGoogle, isDemo } = useAuth()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const authErrorMessage = (message) => {
    const lower = `${message || ''}`.toLowerCase()
    if (lower.includes('invalid login credentials')) return 'That email and password do not match. Check them and try again.'
    if (lower.includes('email not confirmed')) return 'Confirm your email before signing in. Check your inbox for the confirmation link.'
    if (lower.includes('user already registered')) return 'An account already exists for this email. Sign in instead.'
    if (lower.includes('password')) return 'Use a password with at least 6 characters.'
    if (lower.includes('popup') || lower.includes('oauth')) return 'Google sign-in could not open. Allow popups for this site and try again.'
    return message || 'We could not sign you in. Try again.'
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = mode === 'signin'
      ? await signIn({ email, password })
      : await signUp({ email, password, fullName })
    setLoading(false)
    if (result.error) setError(authErrorMessage(result.error.message))
  }

  const handleGoogle = async () => {
    setError('')
    const { error: authError } = await signInWithGoogle()
    if (authError) setError(authErrorMessage(authError.message))
  }

  const features = [
    'Leads from YC, a16z, and other top VC firms',
    'Emails written in your style, not a template',
    'Reusable templates to speed up your outreach',
  ]

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.1fr_0.9fr]">

      {/* ── Left panel ── */}
      <section
        className="relative flex flex-col overflow-hidden px-8 py-10 text-white lg:min-h-screen lg:px-14 xl:px-20"
        style={{ background: '#1C1C1A' }}
      >
        {/* Logo */}
        <div className="relative shrink-0">
          <span className="font-display text-[17px] font-semibold tracking-[-0.04em] text-white/90">Sparrow</span>
        </div>

        {/* Hero */}
        <div className="relative my-auto pb-4 pt-16">
          <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.28em]"
            style={{ color: 'rgba(125,180,128,0.6)' }}>
            Cold email for startups
          </p>
          <h1 className="font-display font-semibold tracking-[-0.04em] text-white"
            style={{ fontSize: 'clamp(2.6rem,5.5vw,4.5rem)', lineHeight: 1.05 }}>
            Email people<br />
            <span style={{ color: '#7DB480' }}>worth emailing.</span>
          </h1>
          <p className="mt-6 max-w-[300px] text-[15px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Sparrow pulls startup leads and drafts emails in your voice, so you spend less time writing and more time talking.
          </p>

          {/* Feature list */}
          <ul className="mt-10 flex flex-col gap-3.5">
            {features.map((text) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: '#557A57' }} />
                <span className="text-[13px] leading-snug" style={{ color: 'rgba(255,255,255,0.52)' }}>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="relative shrink-0 flex items-center justify-between">
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
            © 2026 Sparrow
          </p>
          <div className="flex items-center gap-3 text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
            <a href="/privacy" className="transition-colors hover:text-white/40">Privacy</a>
            <span className="opacity-40">·</span>
            <a href="/terms" className="transition-colors hover:text-white/40">Terms</a>
          </div>
        </div>
      </section>

      {/* ── Right panel ── */}
      <section className="flex min-h-[56vh] items-center bg-surface px-8 py-16 sm:px-10 lg:min-h-screen lg:px-14 xl:px-16">
        <div className="w-full max-w-[360px]">

          <div className="mb-7">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted/60">Account</p>
            <h2 className="mt-2.5 font-display text-[2rem] font-semibold tracking-[-0.04em] text-dark">
              {mode === 'signin' ? 'Welcome back' : 'Create account'}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {mode === 'signin' ? 'Sign in to your Sparrow workspace.' : 'Start reaching the right people today.'}
            </p>
          </div>

          {isDemo && (
            <Banner variant="warning" icon={AlertCircle} size="sm" className="mb-5">
              Demo mode: enter any email and password to continue.
            </Banner>
          )}

          {/* Google */}
          <button
            onClick={handleGoogle}
            className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-accent/20 bg-white px-4 text-sm font-medium text-dark transition-all hover:border-accent/30 hover:bg-warm-50 hover:shadow-sm"
          >
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-accent/15" />
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted/40">or</span>
            <div className="h-px flex-1 bg-accent/15" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'signup' && (
              <div>
                <label className="label">Full name</label>
                <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                  placeholder="Jane Smith" required className="input" />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required className="input" />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required minLength={6} className="input" />
            </div>

            {error && (
              <Banner variant="danger" icon={AlertCircle} size="sm">{error}</Banner>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-5 text-sm text-muted">
            {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              onClick={() => { setError(''); setMode(mode === 'signin' ? 'signup' : 'signin') }}
              className="font-semibold text-primary hover:underline"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </section>
    </div>
  )
}
