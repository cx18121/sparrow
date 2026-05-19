import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

// Editorial nav: wordmark on the left, single sign-in link on the right.
// No "Get started" pill — the hero CTA owns that action, and a duplicate
// pill in the nav competes visually with the hero button.
//
// No brand badge here either: the green-circle Send mark belongs in the
// product UI (Sidebar / favicon), and shouts on a watercolor backdrop.
// The illustration in the hero is the brand expression on this page.
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
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link
          to="/"
          aria-label="Sparrow home"
          className="font-display text-[17px] font-semibold tracking-tight text-dark transition-colors hover:text-primary-700"
        >
          Sparrow
        </Link>

        <Link
          to="/login"
          className="rounded-full px-3.5 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-accent/10 hover:text-dark"
        >
          Sign in
        </Link>
      </div>
    </header>
  )
}
