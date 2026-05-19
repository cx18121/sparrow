import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SparrowLogo } from './SparrowMark'

// Branding rail across the full viewport width. Brand is anchored to the
// actual top-left corner (not the centered max-w-6xl that the body uses),
// and Sign-in is anchored to the actual top-right. The green-circle Send
// mark is back beside the wordmark: with Get-started gone from the nav
// there's no more green-on-green conflict, and the brand needed real
// presence on a wide watercolor backdrop where a 17px wordmark alone
// disappears.
//
// Transparent at top; gains a parchment backdrop with blur after 80px of
// scroll. Per DESIGN.md the one legitimate use of glassmorphism.
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
          className="group flex items-center gap-3 text-dark transition-opacity hover:opacity-90"
        >
          <SparrowLogo
            size={36}
            className="transition-transform duration-300 group-hover:-translate-y-0.5"
          />
          <span
            className="font-display font-semibold tracking-tight"
            style={{ fontSize: '22px', letterSpacing: '-0.018em' }}
          >
            Sparrow
          </span>
        </Link>

        <Link
          to="/login"
          className="rounded-full px-4 py-2 font-display text-[14px] font-medium text-muted transition-colors hover:bg-accent/10 hover:text-dark"
        >
          Sign in
        </Link>
      </div>
    </header>
  )
}
