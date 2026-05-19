import React, { useEffect, useRef, useState } from 'react'
import { SparrowBird } from './SparrowMark'

// Optional second screen. A visitor who scrolls past the hero is curious
// and wants to see what the product actually produces before granting
// Gmail access. They get exactly one beat: a real draft with the two
// hooks called out by short captions tucked beneath it. Nothing else.
//
// Delight: hovering a caption brightens its corresponding highlight in
// the email above (and vice-versa) — a two-way visual tether that makes
// the annotation system feel intelligent rather than static. Trust-line
// numbers also count up from 0 when the strip enters view, so the DB
// feels alive instead of frozen.
//
// Draft content per BRIEF.md §7.1 (Draft A, Linear PM).
export default function EmailDemo() {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const trustRef = useRef<HTMLParagraphElement | null>(null)
  const [inView, setInView] = useState(false)
  const [hoveredHook, setHoveredHook] = useState<1 | 2 | null>(null)
  const [counts, setCounts] = useState<{ a: number; b: number }>({
    a: 0,
    b: 0,
  })

  // IntersectionObserver: when the card enters view, kick off the
  // hook-highlight draw-in.
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

  // Trust-strip count-up. Animates 0 → final once per entry. Respects
  // prefers-reduced-motion by skipping straight to the final numbers.
  useEffect(() => {
    const el = trustRef.current
    if (!el) return
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setCounts({ a: 12317, b: 44 })
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          io.unobserve(e.target)
          const start = performance.now()
          const duration = 900
          const ease = (t: number) => 1 - Math.pow(1 - t, 4) // ease-out quart
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration)
            const p = ease(t)
            setCounts({
              a: Math.round(12317 * p),
              b: Math.round(44 * p),
            })
            if (t < 1) requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }
      },
      { threshold: 0.5 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const setHook = (n: 1 | 2 | null) => () => setHoveredHook(n)

  return (
    <section className="relative px-5 pt-10 pb-20 sm:px-8 sm:pt-12 sm:pb-24">
      <div className="mx-auto w-full max-w-[680px]">
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
            <dt className="self-center font-display text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted">To</dt>
            <dd className="self-center text-[15px] text-dark">
              Priya Shah <span className="text-muted">· Linear, Product</span>
            </dd>
            <dt className="self-center font-display text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted">Subject</dt>
            <dd className="self-center font-display text-[16px] font-medium tracking-[-0.008em] text-dark">
              Question about how Linear hires new-grad PMs
            </dd>
          </dl>

          <div className="bg-[linear-gradient(180deg,#FDFCF8_0%,#F8F4ED_100%)] px-6 py-7 text-[15px] leading-[1.72] text-dark sm:px-7 sm:py-8">
            <p className="mb-3.5">Hi Priya,</p>
            <p className="mb-3.5">
              I've been using Linear since one of my CS classes switched
              to it last spring.{' '}
              <span
                className={`lp-hook ${hoveredHook === 1 ? 'lp-hook-active' : ''}`}
                style={{ ['--hook-delay' as any]: '200ms' }}
                onMouseEnter={setHook(1)}
                onMouseLeave={setHook(null)}
              >
                The thing I keep coming back to is the keyboard speed.
                I'm faster filing a bug in Linear than I am opening Slack
                to talk about one.
              </span>
              <Marker n={1} active={hoveredHook === 1} />{' '}
              Most tools fight my muscle memory; Linear seems to design
              around it.
            </p>
            <p className="mb-3.5">
              I'm{' '}
              <span
                className={`lp-hook ${hoveredHook === 2 ? 'lp-hook-active' : ''}`}
                style={{ ['--hook-delay' as any]: '500ms' }}
                onMouseEnter={setHook(2)}
                onMouseLeave={setHook(null)}
              >
                graduating Cornell in May
              </span>
              <Marker n={2} active={hoveredHook === 2} />{' '}
              and looking at junior PM roles. Would love 15 minutes to
              learn how Linear thinks about hiring new grads. Happy to
              share what I've been working on if it's useful.
            </p>
            <p className="text-muted">Charlie</p>
          </div>

          <div className="flex items-center justify-between border-t border-warm-200 bg-[linear-gradient(180deg,#FAF7F0_0%,#F8F4ED_100%)] px-6 py-3.5 font-display text-[13px] text-muted sm:px-7">
            <span className="flex items-center">
              <span className="lp-dot lp-dot-pulse" />Composed in 7s
            </span>
            <button
              type="button"
              className="lp-approve rounded-full px-3 py-1 font-medium text-primary-700 transition-colors hover:bg-primary/10"
            >
              Approve →
            </button>
          </div>
        </div>

        {/* Annotation block. Each caption is tied to its highlighted
            phrase above via the hoveredHook state — hovering brightens
            the partner in both directions. */}
        <dl className="lp-reveal mt-5 grid gap-4 text-[13.5px] leading-[1.55] text-muted sm:grid-cols-2 sm:gap-7">
          <div
            className={`lp-caption ${hoveredHook === 1 ? 'lp-caption-active' : ''}`}
            onMouseEnter={setHook(1)}
            onMouseLeave={setHook(null)}
          >
            <dt className="mb-1 flex items-center gap-2 font-medium text-dark">
              <Marker n={1} dark active={hoveredHook === 1} />From research
            </dt>
            <dd>
              Three recent Linear posts on Triage. Sparrow picked the
              one that fit a PM hire.
            </dd>
          </div>
          <div
            className={`lp-caption ${hoveredHook === 2 ? 'lp-caption-active' : ''}`}
            onMouseEnter={setHook(2)}
            onMouseLeave={setHook(null)}
          >
            <dt className="mb-1 flex items-center gap-2 font-medium text-dark">
              <Marker n={2} dark active={hoveredHook === 2} />From the resume
            </dt>
            <dd>
              Cornell, May, junior PM. Matched to a post about
              early-career hiring.
            </dd>
          </div>
        </dl>

        {/* Pool-size trust line. Lives here (not in the footer) so it
            lands right after the visitor sees one specific draft — the
            numbers prove the breadth behind that one example. */}
        <p
          ref={trustRef}
          className="lp-reveal mt-12 text-center text-[12.5px] leading-[1.6] text-muted/85"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          One of <span className="font-medium text-dark">{counts.a.toLocaleString()}</span> startups indexed across <span className="font-medium text-dark">{counts.b}</span> sources.
        </p>
      </div>
    </section>
  )
}

function Marker({ n, dark, active }: { n: number; dark?: boolean; active?: boolean }) {
  if (n === 0) return null
  return (
    <span
      className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-medium align-baseline transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        dark
          ? `bg-primary text-warm-50 ${active ? 'scale-110 shadow-[0_3px_10px_rgba(85,122,87,0.45)]' : 'shadow-[0_2px_6px_rgba(85,122,87,0.30)]'}`
          : `bg-primary/15 text-primary-700 ring-1 ring-primary/25 ${active ? 'bg-primary/30 ring-primary/50 scale-110' : ''}`
      }`}
      aria-hidden="true"
    >
      {n}
    </span>
  )
}
