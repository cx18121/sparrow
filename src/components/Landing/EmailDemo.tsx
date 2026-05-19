import React, { useEffect, useRef, useState } from 'react'

// The product-as-proof beat. Editorial split:
//   - Left:  short prose about how the draft was made (research + resume).
//   - Right: the email card artifact, with hooks highlighted.
// Mobile stacks the card above the prose so the artifact still leads.
//
// Highlight hooks per BRIEF.md §7.1: "the keyboard speed — I'm faster filing
// a bug in Linear than I am opening Slack" (from research) and "graduating
// Cornell in May" (from resume).
export default function EmailDemo() {
  // IntersectionObserver fallback for the hook draw-in on browsers without
  // `animation-timeline: view()`. The CSS @supports rule wins where the
  // native timeline exists; this class is only consulted as the fallback.
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
    <section className="relative px-5 py-20 sm:px-8 sm:py-28 lg:py-32">
      <div className="mx-auto grid w-full max-w-6xl gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
        {/* Editorial prose column */}
        <div className="lp-reveal order-2 lg:order-1 lg:pt-12">
          <p className="lp-eyebrow">What it looks like</p>
          <h2
            className="mt-5 font-display font-semibold text-dark"
            style={{
              fontSize: 'clamp(2rem, 4.2vw, 3.25rem)',
              lineHeight: 1.03,
              letterSpacing: '-0.032em',
              textWrap: 'balance',
            }}
          >
            An email Priya would actually open.
          </h2>

          <p className="mt-7 text-[17px] leading-[1.65] text-dark/85">
            Sparrow searches the web for what Linear has shipped recently,
            reads your resume to pick the angle that matches, and drafts
            the email in your voice. Two specifics, one ask, no fluff.
          </p>

          <dl className="mt-10 space-y-5 text-[14px] leading-[1.55]">
            <div className="flex gap-3">
              <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
              <div>
                <dt className="font-medium text-dark">From research</dt>
                <dd className="mt-1 text-muted">
                  Sparrow read three Linear posts about Triage and keyboard
                  shortcuts, then chose the one that fit Priya's role.
                </dd>
              </div>
            </div>
            <div className="flex gap-3">
              <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />
              <div>
                <dt className="font-medium text-dark">From your resume</dt>
                <dd className="mt-1 text-muted">
                  Cornell, May, junior PM — picked because the post is about
                  early-career hiring, not about Linear's roadmap.
                </dd>
              </div>
            </div>
          </dl>
        </div>

        {/* Email card artifact */}
        <div className="order-1 lg:order-2">
          <div
            ref={cardRef}
            className={`lp-email lp-reveal ${inView ? 'lp-email-in-view lp-in-view' : ''}`}
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
                I've been using Linear since one of my CS classes switched to
                it last spring.{' '}
                <span className="lp-hook" style={{ ['--hook-delay' as any]: '200ms' }}>
                  The thing I keep coming back to is the keyboard speed — I'm faster filing a bug in Linear than I am opening Slack to talk about one.
                </span>{' '}
                Most tools fight my muscle memory; Linear seems to design
                around it.
              </p>
              <p className="mb-3.5">
                I'm{' '}
                <span className="lp-hook" style={{ ['--hook-delay' as any]: '500ms' }}>
                  graduating Cornell in May
                </span>{' '}
                and looking at junior PM roles. Would love 15 minutes to
                learn how Linear thinks about hiring new grads. Happy to
                share what I've been working on if it's useful.
              </p>
              <p className="text-muted">— Charlie</p>
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
        </div>
      </div>
    </section>
  )
}
