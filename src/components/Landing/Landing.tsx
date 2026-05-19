import React, { useEffect, useRef } from 'react'
import LandingNav from './Nav'
import Hero from './Hero'
import EmailDemo from './EmailDemo'
import WhyExists from './WhyExists'
import HowItWorks from './HowItWorks'
import FinalCTA from './FinalCTA'
import LandingFooter from './Footer'
import './landing.css'

// Public marketing surface. Composes the five-section landing per
// .scratch/landing/BRIEF.md. The route at `/` renders this for unauthenticated
// visitors; signed-in users are redirected to /dashboard from App.tsx.
export default function Landing({ onSignInWithGoogle }: { onSignInWithGoogle: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  // The unauthenticated branch in App.tsx renders this without the product
  // shell, so the parchment surface needs to extend to the body element to
  // avoid a thin product-surface stripe at top during scroll bounce.
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#F8F1E2'
    return () => { document.body.style.backgroundColor = prev }
  }, [])

  // Scroll-driven reveal fallback. Chromium with `animation-timeline: view()`
  // drives the entrance via CSS — the @supports block in landing.css handles
  // it without JS. For engines without that (Safari, Firefox today) we opt
  // the root into the `.lp-js-fallback` branch, which hides `.lp-reveal`
  // elements until an IntersectionObserver flips them on entry. We gate the
  // fallback on JS support so Chromium isn't double-running motion, and so
  // the rest state of `.lp-reveal` remains "visible" — that way the page
  // still renders correctly if JS never executes (e.g. SSR pre-hydration,
  // user with JS disabled, or a full-page screenshot that never scrolls).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const nativeTimeline =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('animation-timeline: view()')
    if (nativeTimeline) return
    if (typeof IntersectionObserver === 'undefined') return

    root.classList.add('lp-js-fallback')

    const nodes = Array.from(root.querySelectorAll<HTMLElement>('.lp-reveal'))
    if (nodes.length === 0) return

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('lp-in-view')
            io.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    )
    nodes.forEach(n => io.observe(n))
    return () => {
      io.disconnect()
      root.classList.remove('lp-js-fallback')
    }
  }, [])

  return (
    <div ref={rootRef} className="lp-root min-h-screen">
      <LandingNav onSignInWithGoogle={onSignInWithGoogle} />
      <main>
        <Hero onSignInWithGoogle={onSignInWithGoogle} />
        <EmailDemo />
        <WhyExists />
        <HowItWorks />
        <FinalCTA onSignInWithGoogle={onSignInWithGoogle} />
      </main>
      <LandingFooter />
    </div>
  )
}
