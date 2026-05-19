import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

// Branding rail across the full viewport width. Brand anchored to the
// actual top-left corner, Sign-in to the actual top-right.
//
// Wordmark-only. The green-circle paper-plane badge is the product UI
// brand (Sidebar, favicon) and reads as an app icon when dropped onto
// the watercolor backdrop. The page expresses brand through (1) the
// hero illustration and (2) a confident wordmark in deep forest green
// with the "S" set off as a soft accent. No badge.
//
// Transparent at top; gains a parchment backdrop with blur after 80px
// of scroll. Per DESIGN.md the one legitimate use of glassmorphism.
export default function LandingNav() {
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
      <div className="flex h-16 w-full items-center justify-between px-6 sm:h-[72px] sm:px-10 lg:px-12">
        <Link
          to="/"
          aria-label="Sparrow home"
          className="group inline-flex items-baseline font-display font-semibold leading-none"
          style={{
            fontSize: 'clamp(26px, 2.4vw, 32px)',
            letterSpacing: '-0.028em',
            color: '#2C1F10',
          }}
        >
          {/* The "S" gets a small delight: shifts up a hair on hover,
              colour deepens. Subtle enough that it doesn't pull focus,
              present enough to reward the curious cursor. */}
          <span
            className="text-primary-700 transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-[2px] group-hover:text-primary"
            style={{ display: 'inline-block', transformOrigin: 'bottom center' }}
          >
            S
          </span>
          <span className="transition-colors duration-300 group-hover:text-primary-700/85">
            parrow
          </span>
        </Link>

        <Link
          to="/login"
          className="inline-flex min-h-[44px] items-center rounded-full px-4 font-display text-[14px] font-medium text-muted transition-colors hover:bg-accent/10 hover:text-dark"
        >
          Sign in
        </Link>
      </div>
    </header>
  )
}
