import React from 'react'
import { SparrowMark } from './SparrowMark'

// Charlie's origin story carries the trust load (no separate trust strip
// per brief §3). Editorial prose treatment with a marginal sidebar that
// holds the real database stats — confirmed from CLAUDE.md §"DB size"
// (12,317 verified, 6,281 with contacts) rather than invented vanity
// metrics, per brief §7.3.
//
// Story body is a placeholder per brief §7.2 — Charlie will rewrite in
// his voice during build.
export default function WhyExists() {
  return (
    <section
      className="relative px-5 py-24 sm:px-8 sm:py-32 lg:py-40"
      style={{ background: 'linear-gradient(180deg, #F8F1E2 0%, #F5EBD5 60%, #F8F1E2 100%)' }}
    >
      <div className="mx-auto w-full max-w-6xl">
        <div className="lp-reveal grid gap-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-20">
          <article className="lp-measure">
            <p className="lp-eyebrow">Why this exists</p>
            <h2
              className="mt-5 font-display font-semibold text-dark"
              style={{
                fontSize: 'clamp(2rem, 4.2vw, 3.25rem)',
                lineHeight: 1.04,
                letterSpacing: '-0.032em',
                textWrap: 'balance',
              }}
            >
              I'm Charlie. I'm a Cornell senior, graduating in May.
            </h2>

            <div className="mt-10 space-y-6 text-[17.5px] leading-[1.72] text-dark/85">
              <p>
                Last year I applied to about <strong className="font-medium text-dark">200 jobs online</strong> and
                got <strong className="font-medium text-dark">4 callbacks</strong>. So I tried something
                different: I started cold-emailing founders and engineering
                managers directly, with specific notes about their companies.
                The response rate jumped to about <strong className="font-medium text-dark">20%</strong>.
              </p>
              <p>
                The trick was finding something specific to say in each email.
                Doing that for 50 companies a week turned into a part-time job.
                So I built Sparrow with{' '}
                <a
                  href="https://www.cornellgenai.dev/"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary-700 underline decoration-primary/30 decoration-2 underline-offset-4 transition-colors hover:decoration-primary"
                >
                  Cornell GenAI
                </a>{' '}
                to do the research and drafting that made cold-emailing work
                — and keep the human review loop that made it not feel like
                spam.
              </p>
            </div>

            <figure className="my-14">
              <p className="lp-pullquote lp-measure">
                Cold emailing actually works. It just takes time most people don't have.
              </p>
            </figure>

            <p className="mt-12 flex items-center gap-3 font-display text-[15px] font-medium text-dark">
              <SparrowMark size={20} className="text-primary" />
              <span className="text-muted">—</span> Charlie
            </p>
          </article>

          {/* Marginal sidebar: real DB stats, not invented vanity metrics */}
          <aside className="lp-reveal relative lg:pt-24">
            <div className="rounded-3xl border border-accent/15 bg-[rgba(248,244,237,0.85)] p-7 lg:sticky lg:top-32">
              <p className="lp-eyebrow">As of today</p>
              <dl className="mt-5 space-y-5">
                <Stat value="12,317" label="verified startups in Sparrow's database" />
                <div className="lp-hairline" />
                <Stat value="6,281" label="of those with founder or hiring-manager contacts" />
                <div className="lp-hairline" />
                <Stat value="10+" label="curated sources, hand-cleaned" />
              </dl>
              <p className="mt-6 text-[12.5px] leading-[1.65] text-muted">
                YC, a16z, Sequoia, Kleiner Perkins, Greylock, Bessemer,
                FirstRound, GV, Accel, Pear — plus verified startup lists.
                We re-ingest weekly so the picks reflect who's actually hiring.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt
        className="font-display font-semibold text-dark"
        style={{
          fontSize: 'clamp(2rem, 3.4vw, 2.625rem)',
          lineHeight: 1.0,
          letterSpacing: '-0.028em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </dt>
      <dd className="mt-2 text-[13px] leading-[1.5] text-muted">{label}</dd>
    </div>
  )
}
