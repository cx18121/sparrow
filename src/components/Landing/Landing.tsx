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
  // drives the entrance via CSS — the @supports block in landing.css promotes
  // each `.lp-reveal` to the native timeline. For every other engine
  // (Safari, Firefox today) an IntersectionObserver adds `.lp-in-view` on
  // entry; the CSS transition does the rest. Both branches collapse to a
  // no-op under prefers-reduced-motion (see landing.css).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (typeof IntersectionObserver === 'undefined') return

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
    return () => io.disconnect()
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
