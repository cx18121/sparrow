import React from 'react'

// Inline alert banner — a tinted, bordered block for contextual messages
// (errors, warnings, success notes) that live in the page flow rather than
// floating as a Toast.
//
// Use Banner for:    persistent contextual messages tied to a page or section.
// Use Toast for:     transient confirmations and errors after user actions.
// Use Pill for:      short read-only state labels next to other content.

const VARIANTS = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger:  'border-red-200 bg-red-50 text-red-700',
  info:    'border-blue-200 bg-blue-50 text-blue-800',
}

const SIZES = {
  sm: 'px-3 py-2 text-xs gap-1.5',
  md: 'px-4 py-3 text-sm gap-2',
}

export default function Banner({
  children,
  variant = 'info',
  icon: Icon = undefined,
  size = 'md',
  className = '',
  ...rest
}) {
  const variantCls = VARIANTS[variant] || VARIANTS.info
  const sizeCls = SIZES[size] || SIZES.md
  const iconSize = size === 'sm' ? 13 : 15

  return (
    <div
      role="status"
      className={`flex items-start rounded-2xl border ${sizeCls} ${variantCls} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={iconSize} className="mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
    </div>
  )
}
