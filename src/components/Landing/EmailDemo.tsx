import React, { useEffect, useRef, useState } from 'react'
import { SparrowBird } from './SparrowMark'

// Optional second screen. A visitor who scrolls past the hero is curious
// and wants to see what the product actually produces before granting
// Gmail access. They get exactly one beat: a real draft with the two
// hooks called out by short captions tucked beneath it. Nothing else.
//
// Draft content per BRIEF.md §7.1 (Draft A, Linear PM). Hooks:
//   (1) "the keyboard speed ... faster filing a bug than opening Slack"
//       (from research on Linear's product)
//   (2) "graduating Cornell in May" (from the sender's resume)
export default function EmailDemo() {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true)
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -15% 0px', threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section className="relative px-5 pt-10 pb-20 sm:px-8 sm:pt-12 sm:pb-24">
      <div className="mx-auto w-full max-w-[680px]">
        {/* Small printer's-mark ornament: a thin sage rule with a single
            bird silhouette in the middle. Visually bridges the hero
            illustration into this section so the page doesn't feel like
            two halves stuck together. */}
        <div
          aria-hidden
          className="lp-reveal mx-auto flex max-w-[260px] items-center gap-3"
        >
          <span className="h-px flex-1 bg-accent/35" />
          <SparrowBird size={18} className="text-primary/70" />
          <span className="h-px flex-1 bg-accent/35" />
        </div>

        <p className="lp-eyebrow lp-reveal mt-6 text-center">An actual draft</p>

        <div
          ref={cardRef}
          className={`lp-email lp-reveal mx-auto mt-7 ${inView ? 'lp-email-in-view lp-in-view' : ''}`}
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 border-b border-warm-200 bg-[linear-gradient(180deg,#FDFCF8_0%,#FAF7F0_100%)] px-6 py-5 sm:px-7 sm:py-6">
            <dt className="self-center font-display text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted">
              <Marker n={0} />To
            </dt>
            <dd className="self-center text-[15px] text-dark">
              Priya Shah <span className="text-muted">· Linear, Product</span>
            </dd>
            <dt className="self-center font-display text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted">
              <Marker n={0} />Subject
            </dt>
            <dd className="self-center font-display text-[16px] font-medium tracking-[-0.008em] text-dark">
              Question about how Linear hires new-grad PMs
            </dd>
          </dl>

          <div className="bg-[linear-gradient(180deg,#FDFCF8_0%,#F8F4ED_100%)] px-6 py-7 text-[15px] leading-[1.72] text-dark sm:px-7 sm:py-8">
            <p className="mb-3.5">Hi Priya,</p>
            <p className="mb-3.5">
              I've been using Linear since one of my CS classes switched
              to it last spring.{' '}
              <span className="lp-hook" style={{ ['--hook-delay' as any]: '200ms' }}>
                The thing I keep coming back to is the keyboard speed.
                I'm faster filing a bug in Linear than I am opening Slack
                to talk about one.
              </span>
              <Marker n={1} />{' '}
              Most tools fight my muscle memory; Linear seems to design
              around it.
            </p>
            <p className="mb-3.5">
              I'm{' '}
              <span className="lp-hook" style={{ ['--hook-delay' as any]: '500ms' }}>
                graduating Cornell in May
              </span>
              <Marker n={2} />{' '}
              and looking at junior PM roles. Would love 15 minutes to
              learn how Linear thinks about hiring new grads. Happy to
              share what I've been working on if it's useful.
            </p>
            <p className="text-muted">Charlie</p>
          </div>

          <div className="flex items-center justify-between border-t border-warm-200 bg-[linear-gradient(180deg,#FAF7F0_0%,#F8F4ED_100%)] px-6 py-3.5 font-display text-[13px] text-muted sm:px-7">
            <span className="flex items-center"><span className="lp-dot" />Composed in 7s</span>
            <button
              type="button"
              className="rounded-full px-3 py-1 font-medium text-primary-700 transition-colors hover:bg-primary/10"
            >
              Approve →
            </button>
          </div>
        </div>

        {/* Annotation block tucked tight beneath the card. Numbered to
            match the markers in the email body so the reader can pair
            each caption with the highlight it explains. */}
        <dl className="lp-reveal mt-6 grid gap-4 text-[13.5px] leading-[1.55] text-muted sm:grid-cols-2 sm:gap-6">
          <div>
            <dt className="mb-1 flex items-center gap-2 font-medium text-dark">
              <Marker n={1} dark />From research
            </dt>
            <dd>
              Sparrow read three Linear posts about Triage and keyboard
              navigation, then picked the one that fit the recipient.
            </dd>
          </div>
          <div>
            <dt className="mb-1 flex items-center gap-2 font-medium text-dark">
              <Marker n={2} dark />From the resume
            </dt>
            <dd>
              Cornell, May, junior PM. Picked because the post is about
              early-career hiring, not Linear's roadmap.
            </dd>
          </div>
        </dl>
      </div>
    </section>
  )
}

// Small numbered marker that pairs each highlight in the email body
// with its caption underneath. `n={0}` renders nothing (used so the
// To/Subject labels don't get a marker but stay in the same DL row).
function Marker({ n, dark }: { n: number; dark?: boolean }) {
  if (n === 0) return null
  return (
    <span
      className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
        dark
          ? 'bg-dark text-warm-50'
          : 'bg-primary/15 text-primary-700 ring-1 ring-primary/25'
      } align-baseline`}
      aria-hidden="true"
    >
      {n}
    </span>
  )
}
