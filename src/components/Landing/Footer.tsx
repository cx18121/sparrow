import React from 'react'

// Thin landing footer. Wordmark-only (matches the nav), nav links,
// copyright. The DB-coverage trust strip used to live here but has moved
// down to the bottom of EmailDemo where it earns its place — right after
// the visitor sees one specific email, the "here's how big the pool is"
// signal lands as proof rather than as miscellaneous footer text.
export default function LandingFooter() {
  return (
    <footer className="border-t border-accent/15 px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-display text-[14px] font-semibold text-dark">Sparrow</p>

        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-muted"
        >
          <a href="/login" className="transition-colors hover:text-dark">Sign in</a>
          <a href="/privacy" className="transition-colors hover:text-dark">Privacy</a>
          <a href="/terms" className="transition-colors hover:text-dark">Terms</a>
          <a
            href="mailto:charlie.l.xue@gmail.com"
            className="transition-colors hover:text-dark"
          >
            charlie.l.xue@gmail.com
          </a>
        </nav>
      </div>

      <p className="mx-auto mt-6 w-full max-w-6xl text-[11px] text-muted/70">
        © {new Date().getFullYear()} Sparrow.
      </p>
    </footer>
  )
}
