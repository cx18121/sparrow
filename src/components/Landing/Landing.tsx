import React, { useEffect } from 'react'
import LandingNav from './Nav'
import Hero from './Hero'
import EmailDemo from './EmailDemo'
import WhyExists from './WhyExists'
import './landing.css'

// Public marketing surface. Composes the five-section landing per
// .scratch/landing/BRIEF.md. The route at `/` renders this for unauthenticated
// visitors; signed-in users are redirected to /dashboard from App.tsx.
export default function Landing({ onSignInWithGoogle }: { onSignInWithGoogle: () => void }) {
  // The unauthenticated branch in App.tsx renders this without the product
  // shell, so the parchment surface needs to extend to the body element to
  // avoid a thin product-surface stripe at top during scroll bounce.
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#F8F1E2'
    return () => { document.body.style.backgroundColor = prev }
  }, [])

  return (
    <div className="lp-root min-h-screen">
      <LandingNav onSignInWithGoogle={onSignInWithGoogle} />
      <main>
        <Hero onSignInWithGoogle={onSignInWithGoogle} />
        <EmailDemo />
        <WhyExists />
      </main>
    </div>
  )
}
