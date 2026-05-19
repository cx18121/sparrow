import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft } from 'lucide-react'
import Banner from '../ui/Banner'
import { useAuth } from '../../contexts/AuthContext'

// Sign-in page. Used to be the landing surface (black left panel, green
// tagline) but the landing is now a real marketing page at `/`. This
// surface is just the form now: parchment background matching the
// landing, wordmark + back link as light chrome, a centered form. No
// second pitch — the visitor already decided to sign in.
export default function AuthScreen() {
  const { signIn, signUp, signInWithGoogle } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const authErrorMessage = (message: string | undefined) => {
    const lower = `${message || ''}`.toLowerCase()
    if (lower.includes('invalid login credentials')) return 'That email and password do not match. Check them and try again.'
    if (lower.includes('email not confirmed')) return 'Confirm your email before signing in. Check your inbox for the confirmation link.'
    if (lower.includes('user already registered')) return 'An account already exists for this email. Sign in instead.'
    if (lower.includes('password')) return 'Use a password with at least 6 characters.'
    if (lower.includes('popup') || lower.includes('oauth')) return 'Google sign-in could not open. Allow popups for this site and try again.'
    return message || 'We could not sign you in. Try again.'
  }

  const handleSubmit = async (e: React.FormEvent) => {
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

  const isSignIn = mode === 'signin'

  return (
    <div
      className="relative flex min-h-screen flex-col"
      style={{ background: '#F8F1E2', color: '#2C1F10' }}
    >
      {/* Light chrome: wordmark left, back-to-home right. Header height
          and padding match the landing nav (h-16 sm:h-[72px], items-center)
          so the wordmark sits at the exact same viewport position when
          you bounce between the landing and the auth page. */}
      <header className="flex h-16 items-center justify-between px-6 sm:h-[72px] sm:px-10 lg:px-12">
        <Link
          to="/"
          aria-label="Sparrow home"
          className="group inline-flex items-baseline font-display font-semibold leading-none"
          style={{
            fontSize: 'clamp(26px, 2.4vw, 32px)',
            letterSpacing: '-0.028em',
            color: '#2C1F10',
          }}
        >
          <span
            className="text-primary-700 transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-[2px] group-hover:text-primary"
            style={{ display: 'inline-block', transformOrigin: 'bottom center' }}
          >
            S
          </span>
          <span className="transition-colors duration-300 group-hover:text-primary-700/85">
            parrow
          </span>
        </Link>

        <Link
          to="/"
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 font-display text-[13px] font-medium text-muted transition-colors hover:bg-accent/10 hover:text-dark"
        >
          <ArrowLeft size={14} strokeWidth={2.2} />
          Back to home
        </Link>
      </header>

      {/* Form column, centered, single parchment panel. No card chrome:
          a thin warm-tan hairline under the heading is the only divider
          needed; the parchment background and the form's own structure
          do the rest. */}
      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[400px]">
          <h1
            className="font-display font-semibold text-dark"
            style={{
              fontSize: 'clamp(1.875rem, 2.4vw, 2.25rem)',
              lineHeight: 1.04,
              letterSpacing: '-0.024em',
            }}
          >
            {isSignIn ? 'Welcome back' : 'Create account'}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            {isSignIn
              ? 'Sign in to your Sparrow workspace.'
              : 'Start sending cold emails worth opening.'}
          </p>

          <button
            type="button"
            onClick={handleGoogle}
            className="group mt-8 inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-primary px-7 py-4 font-display text-[15px] font-medium text-warm-50 shadow-[0_10px_28px_rgba(85,122,87,0.26)] transition-all duration-300 hover:bg-primary-700 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(85,122,87,0.32)]"
          >
            <GoogleGlyph />
            Continue with Google
          </button>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-accent/20" />
            <span className="font-display text-[11px] font-medium uppercase tracking-[0.22em] text-muted/70">or</span>
            <div className="h-px flex-1 bg-accent/20" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'signup' && (
              <div>
                <label htmlFor="auth-full-name" className="label">Full name</label>
                <input
                  id="auth-full-name"
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                  className="input"
                />
              </div>
            )}
            <div>
              <label htmlFor="auth-email" className="label">Email</label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="input"
              />
            </div>
            <div>
              <label htmlFor="auth-password" className="label">Password</label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="input"
              />
            </div>

            {error && (
              <Banner variant="danger" icon={AlertCircle} size="sm">{error}</Banner>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex h-12 w-full items-center justify-center rounded-full bg-dark px-4 font-display text-[14px] font-medium text-warm-50 transition-all duration-200 hover:bg-dark/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Please wait…' : isSignIn ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            {isSignIn ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => { setError(''); setMode(isSignIn ? 'signup' : 'signin') }}
              className="font-medium text-primary-700 transition-colors hover:text-primary"
            >
              {isSignIn ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </main>

      <footer className="border-t border-accent/15 px-6 py-5 sm:px-10 lg:px-12">
        <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 text-[12px] text-muted/80">
          <p>© {new Date().getFullYear()} Sparrow.</p>
          <div className="flex items-center gap-5">
            <a href="/privacy" className="transition-colors hover:text-dark">Privacy</a>
            <a href="/terms" className="transition-colors hover:text-dark">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#fdfaf5" opacity=".95" />
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#fdfaf5" opacity=".7" />
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#fdfaf5" opacity=".55" />
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#fdfaf5" opacity=".85" />
    </svg>
  )
}
