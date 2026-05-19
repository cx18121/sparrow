import React from 'react'
import { SparrowLogo } from './SparrowMark'

// Thin footer. The signed-out page renders without AppShell's footer, so
// this carries privacy / terms / contact. The trust strip names the real
// numbers (sources, indexed companies, contacts) as an honest aside.
export default function LandingFooter() {
  return (
    <footer className="border-t border-accent/15 px-5 py-10 sm:px-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <SparrowLogo size={30} />
          <p className="font-display text-[14px] font-semibold text-dark">Sparrow</p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-muted">
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

      <p className="mx-auto mt-8 w-full max-w-6xl text-[11.5px] leading-[1.6] text-muted/80">
        12,317 startups indexed across 44 sources. 6,281 with founder or hiring-manager contacts. Updated as we re-ingest.
      </p>

      <p className="mx-auto mt-2 w-full max-w-6xl text-[11px] text-muted/70">
        © {new Date().getFullYear()} Sparrow.
      </p>
    </footer>
  )
}
