import React, { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

export default function AuthScreen() {
  const { signIn, signUp, signInWithGoogle, isDemo } = useAuth()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = mode === 'signin'
      ? await signIn({ email, password })
      : await signUp({ email, password, fullName })

    setLoading(false)
    if (result.error) setError(result.error.message)
  }

  const handleGoogle = async () => {
    setError('')
    const { error: authError } = await signInWithGoogle()
    if (authError) setError(authError.message)
  }

  return (
    <div className="min-h-screen bg-dark lg:grid lg:grid-cols-[1.08fr_0.92fr]">
      <section className="relative overflow-hidden bg-dark px-6 py-10 text-white sm:px-10 lg:flex lg:min-h-screen lg:flex-col lg:justify-center lg:px-14 xl:px-20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_22%,_rgba(27,110,243,0.52),_transparent_24%),radial-gradient(circle_at_82%_30%,_rgba(90,205,255,0.12),_transparent_28%),linear-gradient(180deg,_rgba(255,255,255,0.03),_transparent_55%)]" />
        <div className="absolute inset-y-0 right-0 hidden w-px bg-white/10 lg:block" />
        <div className="relative max-w-xl">
          <h1 className="text-[clamp(4.5rem,11vw,8.75rem)] font-display font-semibold leading-[0.9] tracking-[-0.08em] text-white">
            Cold<span className="text-primary-200">Flow</span>
          </h1>

          <p className="mt-6 max-w-sm text-base leading-8 text-white/70 sm:text-lg">
            Better cold emails. Less friction.
          </p>
        </div>
      </section>

      <section className="flex min-h-[56vh] items-center bg-[linear-gradient(180deg,#fcfbf8_0%,#f7f3eb_100%)] px-6 py-10 sm:px-10 lg:min-h-screen lg:px-14 xl:px-20">
        <div className="w-full max-w-md">
          <div className="mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted/80">Account</p>
            <h2 className="mt-4 text-4xl font-display font-semibold tracking-[-0.04em] text-dark">
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </h2>
          </div>

          {isDemo && (
            <div className="mb-6 flex items-start gap-3 border-l-2 border-amber-400 pl-3">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-xs leading-5 text-amber-700">
                Demo mode: enter any email and password to continue.
              </p>
            </div>
          )}

          <button
            onClick={handleGoogle}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-gray-200/80 bg-white/70 px-4 text-sm font-medium text-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-sm transition-colors hover:bg-white"
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
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-muted">or</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-muted/80">Full name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                  className="h-14 w-full rounded-2xl border border-gray-200/80 bg-white/70 px-4 text-sm text-dark placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                />
              </div>
            )}

            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-muted/80">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="h-14 w-full rounded-2xl border border-gray-200/80 bg-white/70 px-4 text-sm text-dark placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
              />
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-muted/80">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="h-14 w-full rounded-2xl border border-gray-200/80 bg-white/70 px-4 text-sm text-dark placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-2xl bg-red-50/90 p-3">
                <AlertCircle size={13} className="mt-0.5 shrink-0 text-red-500" />
                <p className="text-xs leading-5 text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-14 w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#2f7bf4_0%,#1b6ef3_100%)] px-4 text-base font-medium text-white shadow-[0_18px_40px_-22px_rgba(27,110,243,0.95)] transition-transform duration-150 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
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
