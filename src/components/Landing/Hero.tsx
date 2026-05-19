import React from 'react'
import { ArrowRight } from 'lucide-react'

// Hero is full-bleed: the editorial sparrow illustration sits as a
// background image, and the four-sentence pitch lives in the
// negative-space middle-left where the illustration already leaves room.
// If `public/landing-hero.png` is missing, the background falls through
// to the page cream so the page still renders.
export default function Hero({ onSignInWithGoogle }: { onSignInWithGoogle: () => void }) {
  return (
    <section
      className="lp-hero relative isolate flex min-h-screen items-center overflow-hidden pt-20 sm:pt-24"
      style={{
        backgroundImage: "url('/landing-hero.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#F8F1E2',
      }}
    >
      {/* Soft wash centered behind the type. Tight enough that the
          branch on the left and the birds on the right stay readable as
          illustration. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(48% 50% at 50% 50%, rgba(248,241,226,0.55) 0%, rgba(248,241,226,0.20) 55%, rgba(248,241,226,0) 80%)',
        }}
      />

      {/* Bottom fade. Short enough that the horizon ridge + tree silhouette
          stay readable, just softening the section's bottom edge into the
          page cream. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
        style={{
          background:
            'linear-gradient(180deg, rgba(248,241,226,0) 0%, rgba(248,241,226,1) 100%)',
        }}
      />

      <div className="relative mx-auto w-full max-w-6xl px-5 pb-12 sm:px-8 sm:pb-16">
        {/* Editorial column centered in the viewport. Text inside stays
            left-aligned so prose still reads naturally; the centering
            comes from the column's auto-margin, not text-align-center. */}
        <div className="lp-reveal mx-auto max-w-[580px]">
          <h1
            className="font-display font-semibold text-dark"
            style={{
              fontSize: 'clamp(2.25rem, 4.8vw, 3.5rem)',
              lineHeight: 1.04,
              letterSpacing: '-0.03em',
              textWrap: 'balance',
            }}
          >
            Cold emailing actually works.
          </h1>

          <div
            className="mt-7 space-y-4 text-[16.5px] leading-[1.6] text-dark/85"
            style={{ maxWidth: '50ch' }}
          >
            <p>
              Sparrow drafts the hard part: what to actually say to each
              company, pulled from real research and the line in your
              resume that fits.
            </p>
            <p>
              Drafts wait for you to review. Edit anything, then send
              straight from your Gmail.
            </p>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="button"
              onClick={onSignInWithGoogle}
              className="group inline-flex items-center gap-2.5 whitespace-nowrap rounded-full bg-primary px-7 py-4 font-display text-[15px] font-medium text-warm-50 shadow-[0_10px_28px_rgba(85,122,87,0.26)] transition-all duration-300 hover:bg-primary-700 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(85,122,87,0.32)]"
            >
              <GoogleGlyph />
              Continue with Google
              <ArrowRight
                size={16}
                className="transition-transform duration-300 group-hover:translate-x-1"
                strokeWidth={2.2}
              />
            </button>
            <p className="text-[13px] text-muted">
              Free for students. For internships and full-time roles.
            </p>
          </div>
        </div>
      </div>
    </section>
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
