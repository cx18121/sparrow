import React from 'react'
import { getStatusTone } from './statusTokens'

// Tinted status chip - a small rounded label with a semantic background.
// Use for short read-only state labels: "Hiring", "Ready", "Needs review".
// For interactive status changers (like a select), use statusTokens directly
// rather than wrapping the form control.
//
// For "label + status indicator dot" (campaign status, draft state), prefer
// the Badge component instead.

export default function Pill({
  children,
  variant = 'neutral',
  icon: Icon = undefined,
  dot = false,
  className = '',
}) {
  const tone = getStatusTone(variant)
  const variantCls = `${tone.surface} ${tone.text}`
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 ${variantCls} ${className}`}
    >
      {dot && <span className={`h-1 w-1 rounded-full ${tone.dot}`} />}
      {Icon && <Icon size={10} />}
      {children}
    </span>
  )
}
