import React, { useEffect, useRef } from 'react'
import LandingNav from './Nav'
import Hero from './Hero'
// EmailDemo archived for now — component lives at ./EmailDemo.tsx if needed.
// import EmailDemo from './EmailDemo'
import LandingFooter from './Footer'
import './landing.css'

// Public marketing surface. Two screens of content: the hero (single
// fold, no scroll required) and an optional email-card artifact below
// for visitors who want to see the product before granting Gmail access.
// Nothing more.
export default function Landing({ onSignInWithGoogle }: { onSignInWithGoogle: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#F8F1E2'
    return () => { document.body.style.backgroundColor = prev }
  }, [])

  // IntersectionObserver fallback for the .lp-reveal animation on engines
  // without `animation-timeline: view()`. See landing.css for the @supports
  // branch that drives motion natively in Chromium.
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
      <LandingNav />
      <main>
        <Hero onSignInWithGoogle={onSignInWithGoogle} />
        {/* <EmailDemo /> */}
      </main>
      <LandingFooter />
    </div>
  )
}
