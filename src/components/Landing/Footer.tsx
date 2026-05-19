import React from 'react'

// Thin landing footer. Matches the nav wordmark treatment (green "S" +
// ink "parrow"), carries a one-line tagline so the footer says something
// about the brand instead of being utility links, and links Privacy /
// Terms / Contact. Contact is a mailto link with "Contact" as the
// visible text so the personal address doesn't sit in the page source
// for scrapers to harvest.
export default function LandingFooter() {
  return (
    <footer className="border-t border-accent/15 px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p
            className="font-display font-semibold leading-none"
            style={{
              fontSize: '20px',
              letterSpacing: '-0.024em',
              color: '#2C1F10',
            }}
          >
            <span className="text-primary-700">S</span>parrow
          </p>
          <p className="mt-3 text-[12.5px] leading-[1.5] text-muted/85">
            Drafts in your Gmail. You hit send.
          </p>
        </div>

        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-muted"
        >
          <a href="/privacy" className="transition-colors hover:text-dark">Privacy</a>
          <a href="/terms" className="transition-colors hover:text-dark">Terms</a>
          <a
            href="mailto:charlie.l.xue@gmail.com"
            className="transition-colors hover:text-dark"
          >
            Contact
          </a>
        </nav>
      </div>

      <p className="mx-auto mt-6 w-full max-w-6xl text-[11px] text-muted/70">
        © {new Date().getFullYear()} Sparrow.
      </p>
    </footer>
  )
}
