import React, { useState } from 'react'
import { AlertCircle, Bird } from 'lucide-react'
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

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.08fr_0.92fr]">

      {/* ── Left panel ── */}
      <section
        className="relative overflow-hidden px-8 py-12 text-white lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:px-14 xl:px-20"
        style={{ background: 'linear-gradient(160deg, #2C1F10 0%, #1a1208 60%, #243320 100%)' }}
      >
        {/* Decorative circles — feather-like organic shapes */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-[0.07]"
          style={{ background: 'radial-gradient(circle, #A8CFA9 0%, transparent 70%)' }} />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full opacity-[0.06]"
          style={{ background: 'radial-gradient(circle, #DCB98A 0%, transparent 70%)' }} />
        <div className="pointer-events-none absolute bottom-1/3 right-8 h-48 w-48 rounded-full opacity-[0.05]"
          style={{ background: 'radial-gradient(circle, #7DB480 0%, transparent 70%)' }} />

        {/* Thin right border */}
        <div className="absolute inset-y-0 right-0 hidden w-px lg:block"
          style={{ background: 'linear-gradient(to bottom, transparent, rgba(168,132,92,0.3) 40%, rgba(168,132,92,0.3) 60%, transparent)' }} />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(168,132,92,0.20)' }}>
            <Bird size={19} strokeWidth={1.8} className="text-accent-200" />
          </div>
          <span className="font-display text-lg font-semibold tracking-[-0.02em] text-white/90">Sparrow</span>
        </div>

        {/* Hero text */}
        <div className="relative my-auto py-16">
          <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.28em]"
            style={{ color: 'rgba(168,132,92,0.80)' }}>
            Cold outreach, reimagined
          </p>
          <h1 className="font-display text-[clamp(3.2rem,7vw,6rem)] font-semibold leading-[0.92] tracking-[-0.06em] text-white">
            Reach the<br />
            <span style={{ color: '#A8CFA9' }}>right people.</span>
          </h1>
          <p className="mt-7 max-w-xs text-base leading-7" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Find leads, write tailored emails, and send campaigns — without the noise.
          </p>

          {/* Feature bullets */}
          <ul className="mt-10 space-y-3">
            {[
              'AI-crafted emails that sound like you',
              'Lead discovery from 50+ VC portfolios',
              'Campaigns with built-in follow-ups',
            ].map(f => (
              <li key={f} className="flex items-center gap-3 text-sm" style={{ color: 'rgba(255,255,255,0.60)' }}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: '#7DB480' }} />
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom tagline */}
        <p className="relative text-xs" style={{ color: 'rgba(255,255,255,0.28)' }}>
          © 2025 Sparrow · Smart outreach for modern teams
        </p>
      </section>

      {/* ── Right panel ── */}
      <section className="flex min-h-[56vh] items-center bg-surface px-8 py-12 sm:px-10 lg:min-h-screen lg:px-14 xl:px-20">
        <div className="w-full max-w-md">

          <div className="mb-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted/70">Account</p>
            <h2 className="mt-3 font-display text-[2.25rem] font-semibold tracking-[-0.04em] text-dark">
              {mode === 'signin' ? 'Welcome back' : 'Create account'}
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              {mode === 'signin' ? 'Sign in to your Sparrow workspace.' : 'Start reaching the right people today.'}
            </p>
          </div>

          {isDemo && (
            <Banner variant="warning" icon={AlertCircle} size="sm" className="mb-6">
              Demo mode: enter any email and password to continue.
            </Banner>
          )}

          {/* Google */}
          <button
            onClick={handleGoogle}
            className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl border border-warm-300 bg-warm-50 px-4 text-sm font-medium text-dark transition-all hover:border-accent/40 hover:bg-warm-100"
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-warm-200" />
            <span className="text-xs text-muted">or</span>
            <div className="h-px flex-1 bg-warm-200" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="label">Full name</label>
                <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                  placeholder="Jane Smith" required className="input-lg" />
              </div>
            )}

            <div>
              <label className="label">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required className="input-lg" />
            </div>

            <div>
              <label className="label">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required minLength={6} className="input-lg" />
            </div>

            {error && (
              <Banner variant="danger" icon={AlertCircle} size="sm">{error}</Banner>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-14 w-full items-center justify-center rounded-2xl bg-primary px-4 text-base font-medium text-white transition-all duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ boxShadow: '0 8px 24px rgba(85,122,87,0.30)' }}
            >
              {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-sm text-muted">
            {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              onClick={() => { setError(''); setMode(mode === 'signin' ? 'signup' : 'signin') }}
              className="font-medium text-primary hover:underline"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </section>
    </div>
  )
}
