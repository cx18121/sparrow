import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SparrowMark } from './SparrowMark'

// Sticky top bar. Transparent at the top of the page; after 80px of scroll,
// it gains a parchment backdrop with backdrop-blur. Per DESIGN.md this is
// the one legitimate use of glassmorphism in the system.
export default function LandingNav({ onSignInWithGoogle }: { onSignInWithGoogle: () => void }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,backdrop-filter,border-color] duration-300 ${
        scrolled
          ? 'border-b border-accent/15 bg-[rgba(248,241,226,0.72)] backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent backdrop-blur-0'
      }`}
    >
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link to="/" className="group flex items-center gap-2.5" aria-label="Sparrow home">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-warm-50 shadow-brand transition-transform duration-300 group-hover:-translate-y-0.5">
            <SparrowMark size={16} />
          </span>
          <span className="font-display text-[17px] font-semibold tracking-tight text-dark">
            Sparrow
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <Link
            to="/login"
            className="hidden rounded-full px-3.5 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-accent/10 hover:text-dark sm:inline-flex"
          >
            Sign in
          </Link>
          <button
            type="button"
            onClick={onSignInWithGoogle}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-warm-50 shadow-[0_8px_18px_rgba(85,122,87,0.20)] transition-all duration-200 hover:brightness-110 hover:translate-y-[-1px]"
          >
            Get started
          </button>
        </nav>
      </div>
    </header>
  )
}
