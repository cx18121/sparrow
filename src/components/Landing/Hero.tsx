import React from 'react'
import { ArrowRight } from 'lucide-react'
import { SparrowMark } from './SparrowMark'

// Sparrow flock placeholder. Five birds in the upper third, asymmetric, low
// opacity. Swap-in plan per BRIEF.md §6: replace with a `background-image`
// on .lp-hero once `src/assets/landing-hero.png` exists.
const FLOCK = [
  { top: '14%', left: '58%', size: 84, opacity: 0.16, rotate: -8 },
  { top: '8%',  left: '76%', size: 52, opacity: 0.14, rotate: -2 },
  { top: '22%', left: '88%', size: 36, opacity: 0.12, rotate: 6  },
  { top: '4%',  left: '40%', size: 28, opacity: 0.10, rotate: -14 },
  { top: '30%', left: '70%', size: 26, opacity: 0.13, rotate: 3  },
]

export default function Hero({ onSignInWithGoogle }: { onSignInWithGoogle: () => void }) {
  return (
    <section className="lp-hero relative overflow-hidden pt-32 pb-24 sm:pt-40 sm:pb-32 lg:pt-48 lg:pb-40">
      {/* CSS-only sparrow flock — placeholder for the editorial hero image */}
      <div className="lp-flock" aria-hidden="true">
        {FLOCK.map((b, i) => (
          <span
            key={i}
            className="lp-flock-bird"
            style={{
              top: b.top,
              left: b.left,
              opacity: b.opacity,
              transform: `rotate(${b.rotate}deg)`,
            }}
          >
            <SparrowMark size={b.size} />
          </span>
        ))}
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="lp-reveal max-w-[18ch]">
          <p className="lp-eyebrow">For graduating students</p>
          <h1
            className="mt-6 font-display font-semibold text-dark"
            style={{
              fontSize: 'clamp(2.75rem, 8.5vw, 6.25rem)',
              lineHeight: 0.98,
              letterSpacing: '-0.038em',
              textWrap: 'balance',
            }}
          >
            Email people<br />worth emailing.
          </h1>

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
            <button
              type="button"
              onClick={onSignInWithGoogle}
              className="group inline-flex items-center gap-2.5 rounded-full bg-primary px-7 py-4 font-display text-[15px] font-medium text-warm-50 shadow-[0_10px_28px_rgba(85,122,87,0.26)] transition-all duration-300 hover:bg-primary-700 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(85,122,87,0.32)]"
            >
              <GoogleGlyph />
              Continue with Google
              <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" strokeWidth={2.2} />
            </button>
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <SparrowMark size={14} className="text-primary" />
              Free for students.
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
