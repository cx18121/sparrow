import React, { useEffect, useRef, useState } from 'react'

// Optional second screen. A visitor who scrolls past the hero is curious
// and wants to see what the product actually produces before granting
// Gmail access. They get exactly one beat: a real draft, with the two
// hooks called out by short captions. Nothing else.
//
// Draft content per BRIEF.md §7.1 (Draft A, Linear PM). Hooks:
//   1. "the keyboard speed ... faster filing a bug than opening Slack"
//      (from research on Linear's product)
//   2. "graduating Cornell in May" (from the sender's resume)
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
    <section className="relative px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto w-full max-w-5xl">
        <p className="lp-eyebrow lp-reveal text-center">An actual draft</p>

        <div
          ref={cardRef}
          className={`lp-email lp-reveal mx-auto mt-10 max-w-[620px] ${inView ? 'lp-email-in-view lp-in-view' : ''}`}
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
              <span className="lp-hook" style={{ ['--hook-delay' as any]: '200ms' }}>
                The thing I keep coming back to is the keyboard speed. I'm faster filing a bug in Linear than I am opening Slack to talk about one.
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

        <div className="mx-auto mt-10 grid max-w-[620px] gap-3 text-[14px] leading-[1.55] text-muted sm:grid-cols-2 sm:gap-5">
          <p>
            <span className="font-medium text-dark">The first highlighted line</span> came from research. Sparrow read three Linear posts about Triage and keyboard navigation, then picked the one that matched the recipient.
          </p>
          <p>
            <span className="font-medium text-dark">The second</span> came from the sender's resume. Cornell, May, junior PM, picked because the post is about early-career hiring.
          </p>
        </div>
      </div>
    </section>
  )
}
