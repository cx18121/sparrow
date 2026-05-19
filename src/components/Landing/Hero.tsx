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
      className="lp-hero relative isolate flex min-h-screen items-center overflow-hidden bg-[#F8F1E2] bg-no-repeat pt-20 sm:pt-24"
      style={{
        backgroundImage: "url('/landing-hero.png')",
        backgroundSize: 'cover',
        // Portrait crops shift the focal point to the upper-right so at
        // least one bird stays visible above the headline; wide viewports
        // use center-top so the full composition (branch + birds + sky)
        // reads. Custom CSS variable consumed by a class-driven media
        // query below would be cleaner, but a simple inline style block
        // doesn't have media-query syntax, so this is set with a small
        // utility class instead.
      }}
    >
      {/* Soft wash centered behind the type. On mobile the wash is
          stronger and slightly bigger so the body copy stays legible
          when the crop pulls illustration detail closer to the text. */}
      <div
        aria-hidden
        className="lp-hero-wash pointer-events-none absolute inset-0"
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
        {/* Column width scales with viewport: 580px on laptop, 720px on
            large desktop, 820px on ultra-wide. Stops the text from
            looking marooned on a 27"+ monitor while staying comfortably
            readable on a 13" laptop. */}
        <div className="lp-reveal mx-auto max-w-[580px] xl:max-w-[680px] 2xl:max-w-[780px]">
          <h1
            className="font-display font-semibold text-dark"
            style={{
              fontSize: 'clamp(2rem, 3.8vw, 3.75rem)',
              lineHeight: 1.04,
              letterSpacing: '-0.03em',
              textWrap: 'balance',
              fontKerning: 'normal',
            }}
          >
            Cold emailing actually works.
            <span className="block text-primary-700">Sparrow makes it easy.</span>
          </h1>

          <div
            className="mt-7 space-y-3.5 text-dark/85"
            style={{
              maxWidth: '52ch',
              fontSize: 'clamp(16px, 1.15vw, 19px)',
              lineHeight: 1.6,
              textWrap: 'pretty',
            }}
          >
            <p>
              Sparrow drafts each email from real research about the
              company and a matching line in your resume.
            </p>
            <p>You review every draft, then send from your Gmail.</p>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
            <button
              type="button"
              onClick={onSignInWithGoogle}
              className="group inline-flex min-h-[56px] items-center gap-3 whitespace-nowrap rounded-full bg-primary px-8 py-4 font-display text-[16px] font-medium text-warm-50 shadow-[0_14px_36px_rgba(85,122,87,0.32),inset_0_1px_0_rgba(255,255,255,0.18)] transition-all duration-300 hover:bg-primary-700 hover:-translate-y-0.5 hover:shadow-[0_20px_44px_rgba(85,122,87,0.40),inset_0_1px_0_rgba(255,255,255,0.22)]"
            >
              <GoogleGlyph />
              Continue with Google
              <ArrowRight
                size={18}
                className="transition-transform duration-300 group-hover:translate-x-1.5"
                strokeWidth={2.3}
              />
            </button>
            <p className="text-[13px] text-muted">
              Free for students. Built for finding internships and full-time roles.
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
