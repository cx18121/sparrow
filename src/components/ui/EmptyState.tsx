import React from 'react'

// Empty-state block — what shows up when a list, table, or panel has nothing
// in it yet. Centered by default; pass `align="left"` for inline placements
// where a centered block would feel orphaned (e.g. an aside in the dashboard).
//
// Three call shapes:
//   <EmptyState>Single message</EmptyState>
//   <EmptyState title="…" description="…" />
//   <EmptyState icon={X} title="…" description="…" action={<button …/>} />
//
// Empty-state design principle (PRODUCT.md #1): the next action should be
// obvious. Prefer the title + description + action shape on top-level surfaces
// so the user can keep moving.

export default function EmptyState({
  icon: Icon = undefined,
  title = undefined,
  description = undefined,
  action = undefined,
  align = 'center',
  className = '',
  children = undefined,
}) {
  const isLeft = align === 'left'
  const body = description ?? children
  return (
    <div
      className={`flex flex-col px-4 py-10 ${
        isLeft ? 'items-start text-left' : 'items-center text-center'
      } ${className}`}
    >
      {Icon && <Icon size={22} strokeWidth={1.75} className="mb-3 text-muted/70" />}
      {title && <p className="text-sm font-medium text-dark">{title}</p>}
      {body && (
        <p className={`max-w-md text-sm leading-6 text-muted ${title ? 'mt-1' : ''}`}>
          {body}
        </p>
      )}
      {action && (
        <div className={`mt-4 flex flex-wrap gap-2 ${isLeft ? '' : 'justify-center'}`}>
          {action}
        </div>
      )}
    </div>
  )
}
