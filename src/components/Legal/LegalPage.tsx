import React from 'react'

// Shared shell used by both legal pages — header with logo + last-updated
// stamp, max-width content well. Lives next to its consumers so adding
// a third legal page (cookie policy etc.) is a one-file add.

export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface px-6 py-12">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="mb-8 inline-block font-display text-lg font-semibold text-dark">Sparrow</a>
        <h1 className="font-display text-3xl font-semibold text-dark">{title}</h1>
        <p className="mt-1 text-sm text-muted">Last updated: May 2, 2026</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-dark/80">{children}</div>
      </div>
    </div>
  )
}
