import React from 'react'
import { ArrowRight } from 'lucide-react'
import { SparrowMark } from './SparrowMark'

// Closing beat. Single calmer panel: claim + CTA + microcopy. Distinct from
// the hero by treatment (centered, smaller flock arc above the type) and by
// stance (the hero opens; this one closes).
export default function FinalCTA({ onSignInWithGoogle }: { onSignInWithGoogle: () => void }) {
  return (
    <section
      className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-32"
      style={{ background: 'linear-gradient(180deg, #F8F1E2 0%, #F0E2C4 100%)' }}
    >
      {/* Quiet flock arc above the type — different composition from the
          hero so the two flock moments don't read as a repeat. */}
      <div className="pointer-events-none absolute inset-x-0 top-10 flex justify-center gap-12 opacity-[0.18]" aria-hidden>
        <SparrowMark size={28} className="text-primary -rotate-6" />
        <SparrowMark size={20} className="text-primary -translate-y-2 rotate-3" />
        <SparrowMark size={36} className="text-primary translate-y-1 -rotate-2" />
        <SparrowMark size={22} className="text-primary -translate-y-3 rotate-6" />
      </div>

      <div className="lp-reveal relative mx-auto max-w-3xl text-center">
        <p className="lp-eyebrow">Ready to try it?</p>
        <h2
          className="mt-5 font-display font-semibold text-dark"
          style={{
            fontSize: 'clamp(2.25rem, 5.2vw, 4rem)',
            lineHeight: 1.02,
            letterSpacing: '-0.034em',
            textWrap: 'balance',
          }}
        >
          Stop applying.<br />Start emailing.
        </h2>

        <div className="mt-12 flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={onSignInWithGoogle}
            className="group inline-flex items-center gap-2.5 rounded-full bg-primary px-7 py-4 font-display text-[15px] font-medium text-warm-50 shadow-[0_10px_28px_rgba(85,122,87,0.26)] transition-all duration-300 hover:bg-primary-700 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(85,122,87,0.32)]"
          >
            <GoogleGlyph />
            Continue with Google
            <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" strokeWidth={2.2} />
          </button>
          <p className="text-[13px] text-muted">
            Free for students · Connect Gmail in 30 seconds · Sparrow never auto-sends
          </p>
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
