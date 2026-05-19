import React, { useEffect, useRef, useState } from 'react'

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
  const [inView, setInView] = useState(false)
  const [hoveredHook, setHoveredHook] = useState<1 | 2 | null>(null)

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

  const setHook = (n: 1 | 2 | null) => () => setHoveredHook(n)

  return (
    <section className="relative px-5 pt-10 pb-20 sm:px-8 sm:pt-12 sm:pb-24">
      <div className="mx-auto w-full max-w-[680px]">
        <p className="lp-eyebrow lp-reveal text-center">Drafted by Sparrow</p>

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
        </div>

        {/* Annotation block. Each caption is tied to its highlighted
            phrase above via the hoveredHook state — hovering brightens
            the partner in both directions. */}
        <dl className="lp-reveal mt-12 grid gap-4 text-[13.5px] leading-[1.55] text-muted sm:grid-cols-2 sm:gap-7">
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
      </div>
    </section>
  )
}

// Unified marker. Same solid-forest pill in the email body and the
// captions below — one visual language for the "look at this linked
// phrase" callout, instead of a tinted-pill body variant vs solid-pill
// caption variant. The `dark` prop is kept as a no-op so call sites
// don't need to change.
function Marker({ n, active }: { n: number; dark?: boolean; active?: boolean }) {
  if (n === 0) return null
  return (
    <span
      className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-warm-50 align-baseline transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        active
          ? 'scale-110 shadow-[0_3px_10px_rgba(85,122,87,0.45)]'
          : 'shadow-[0_2px_6px_rgba(85,122,87,0.30)]'
      }`}
      aria-hidden="true"
    >
      {n}
    </span>
  )
}
