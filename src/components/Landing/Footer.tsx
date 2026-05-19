import React from 'react'
import { SparrowMark } from './SparrowMark'

// Landing-specific footer. Distinct from the in-app footer (rendered in
// AppShell) because (a) signed-out visitors don't see the AppShell and
// (b) the marketing surface earns a fuller credit and contact strip.
export default function LandingFooter() {
  return (
    <footer className="border-t border-accent/15 px-5 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-warm-50 shadow-brand">
            <SparrowMark size={18} />
          </span>
          <div>
            <p className="font-display text-[15px] font-semibold text-dark">Sparrow</p>
            <p className="mt-1 max-w-[28ch] text-[12.5px] leading-[1.55] text-muted">
              Made by{' '}
              <a
                href="https://www.cornellgenai.dev/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary-700 underline-offset-2 hover:underline"
              >
                Cornell Generative AI
              </a>
              . Free for students.
            </p>
          </div>
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
      <p className="mx-auto mt-10 w-full max-w-6xl text-[11px] text-muted/70">
        © {new Date().getFullYear()} Sparrow. Sparrow drafts; you send.
      </p>
    </footer>
  )
}
