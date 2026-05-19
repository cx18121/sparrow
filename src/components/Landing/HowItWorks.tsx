import React from 'react'
import { ArrowRight, Check, X } from 'lucide-react'

// Show-the-mechanism beat per brief §3 ("Not numbered cards"). Four moments
// in the pipeline, each paired with a real artifact instead of an icon-card.
// Alternating image-left / image-right rhythm on desktop; on mobile the
// artifact stacks above its prose so the artifact still leads.
export default function HowItWorks() {
  return (
    <section className="relative px-5 py-24 sm:px-8 sm:py-32 lg:py-40">
      <div className="mx-auto w-full max-w-6xl">
        <header className="lp-reveal mx-auto max-w-3xl text-center">
          <p className="lp-eyebrow">How it works</p>
          <h2
            className="mt-5 font-display font-semibold text-dark"
            style={{
              fontSize: 'clamp(2rem, 4.2vw, 3.25rem)',
              lineHeight: 1.03,
              letterSpacing: '-0.032em',
              textWrap: 'balance',
            }}
          >
            Show, don't tell.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-[1.7] text-dark/75">
            Four steps. None of them are you copy-pasting a template into
            Gmail and tweaking the company name.
          </p>
        </header>

        <div className="mt-24 space-y-28 lg:mt-32 lg:space-y-36">
          <Beat
            index="01"
            verb="It searches."
            blurb="Sparrow asks Exa to find the most relevant recent posts about each company — launches, roadmap notes, hiring signals — filtered to the last six months so the angles aren't stale."
            artifact={<SearchArtifact />}
          />
          <Beat
            index="02"
            verb="It reads."
            blurb="Claude synthesizes the search results into a three-line dossier — recent shipping, current focus, hiring signal — that drops the marketing-page boilerplate and keeps only what's worth a sentence in your email."
            artifact={<DossierArtifact />}
            flipped
          />
          <Beat
            index="03"
            verb="It drafts."
            blurb="Your resume is the second input. Sparrow picks the angle from your background that fits the dossier — the ML class, the side project, the YC summer — and writes the draft around that match."
            artifact={<DraftArtifact />}
          />
          <Beat
            index="04"
            verb="You review."
            blurb="Every draft sits in a queue. Edit, send, or skip. Sparrow never auto-sends; the human review loop is what makes the email work without feeling like spam."
            artifact={<ReviewArtifact />}
            flipped
          />
        </div>
      </div>
    </section>
  )
}

function Beat({
  index, verb, blurb, artifact, flipped,
}: {
  index: string; verb: string; blurb: string; artifact: React.ReactNode; flipped?: boolean
}) {
  return (
    <div className="lp-reveal grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
      <div className={`${flipped ? 'lg:order-2' : ''}`}>
        <p className="font-display text-[13px] font-medium tracking-[0.2em] text-primary-700">
          {index}
        </p>
        <h3
          className="mt-3 font-display font-semibold text-dark"
          style={{
            fontSize: 'clamp(1.625rem, 3.2vw, 2.375rem)',
            lineHeight: 1.05,
            letterSpacing: '-0.024em',
          }}
        >
          {verb}
        </h3>
        <p className="mt-5 max-w-[40ch] text-[16.5px] leading-[1.7] text-dark/80">
          {blurb}
        </p>
      </div>
      <div className={`${flipped ? 'lg:order-1' : ''}`}>{artifact}</div>
    </div>
  )
}

/* ── Artifacts ─────────────────────────────────────────────────────────── */

function SearchArtifact() {
  const results = [
    { source: 'linear.app/blog', title: 'Triage: a new view for unsorted issues', when: '3 weeks ago' },
    { source: 'techcrunch.com', title: 'Linear raises $35M Series B led by Accel', when: '2 months ago' },
    { source: 'linear.app/changelog', title: 'Sub-50ms keyboard navigation on every list view', when: '5 months ago' },
  ]
  return (
    <div className="rounded-2xl border border-accent/20 bg-panel p-2 shadow-[0_24px_60px_-30px_rgba(44,31,16,0.25)]">
      <div className="flex items-center gap-2 rounded-xl bg-warm-50 px-4 py-3 font-display text-[13px] text-muted">
        <SearchIcon /> linear.app — last 180 days
      </div>
      <ul className="mt-1 divide-y divide-warm-200">
        {results.map((r) => (
          <li key={r.title} className="flex items-baseline justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <p className="truncate font-display text-[10.5px] uppercase tracking-[0.18em] text-muted">{r.source}</p>
              <p className="mt-1 truncate text-[14px] text-dark">{r.title}</p>
            </div>
            <span className="shrink-0 text-[12px] text-muted">{r.when}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DossierArtifact() {
  return (
    <div className="rounded-2xl border border-accent/20 bg-panel p-7 shadow-[0_24px_60px_-30px_rgba(44,31,16,0.25)]">
      <p className="font-display text-[10.5px] uppercase tracking-[0.2em] text-muted">Linear · dossier</p>
      <dl className="mt-5 space-y-4 text-[14.5px] leading-[1.6]">
        <Row k="Recent" v="Shipped Triage — keyboard-first inbox for unsorted issues. Heavy emphasis on speed." />
        <Row k="Focus"  v="Sub-50ms response targets on every navigation. Engineering culture, not surface polish." />
        <Row k="Signal" v="Hiring junior PMs out of CS programs. Series B, ~80 people, US/EU." />
      </dl>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[68px_1fr] gap-4">
      <dt className="pt-[3px] font-display text-[10.5px] uppercase tracking-[0.18em] text-primary-700">{k}</dt>
      <dd className="text-dark/85">{v}</dd>
    </div>
  )
}

function DraftArtifact() {
  return (
    <div className="rounded-2xl border border-accent/20 bg-paper p-7 shadow-[0_24px_60px_-30px_rgba(44,31,16,0.25)]">
      <p className="font-display text-[10.5px] uppercase tracking-[0.2em] text-muted">Body · excerpt</p>
      <p className="mt-5 text-[15px] leading-[1.72] text-dark">
        I've been using Linear since one of my CS classes switched to it.{' '}
        <span className="lp-hook lp-email-in-view">The thing I keep coming back to is the keyboard speed</span>{' '}
        — I'm faster filing a bug in Linear than I am opening Slack to talk
        about one.
      </p>
      <p className="mt-4 text-[15px] leading-[1.72] text-dark">
        I'm{' '}
        <span className="lp-hook lp-email-in-view">graduating Cornell in May</span>{' '}
        and looking at junior PM roles.
      </p>
    </div>
  )
}

function ReviewArtifact() {
  const rows = [
    { name: 'Priya Shah',    org: 'Linear',   subject: 'Question about how Linear hires new-grad PMs',     active: true  },
    { name: 'Marcus Lee',    org: 'Rippling', subject: 'Notes on the new HRIS analytics view',            active: false },
    { name: 'Alex Tarpinian', org: 'Replit',   subject: 'How Replit thinks about students shipping demos', active: false },
  ]
  return (
    <div className="rounded-2xl border border-accent/20 bg-panel p-2 shadow-[0_24px_60px_-30px_rgba(44,31,16,0.25)]">
      <div className="flex items-center justify-between rounded-xl bg-warm-50 px-4 py-3">
        <p className="font-display text-[13px] text-dark">Today's drafts</p>
        <p className="font-display text-[11px] uppercase tracking-[0.18em] text-muted">3 ready</p>
      </div>
      <ul className="mt-1 divide-y divide-warm-200">
        {rows.map((r) => (
          <li
            key={r.name}
            className={`flex items-center gap-3 px-4 py-3.5 ${r.active ? 'bg-primary/[0.06]' : ''}`}
          >
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${r.active ? 'bg-primary' : 'bg-warm-300'}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-dark">
                {r.name} <span className="font-normal text-muted">· {r.org}</span>
              </p>
              <p className="truncate text-[12.5px] text-muted">{r.subject}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-warm-200 hover:text-dark"
                aria-label="Skip"
              >
                <X size={13} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11.5px] font-medium text-warm-50 transition-colors hover:bg-primary-700"
              >
                <Check size={11} strokeWidth={2.6} /> Send
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}
