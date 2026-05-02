import React from 'react'

// Tinted status chip — a small rounded label with a semantic background.
// Use for short read-only state labels: "Hiring", "Ready", "Needs review".
// For interactive status changers (like a select), use the variant tokens
// directly from VARIANT_STYLES rather than wrapping the form control.
//
// For "label + status indicator dot" (campaign status, draft state), prefer
// the Badge component instead.

export const VARIANT_STYLES = {
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger:  'bg-red-50 text-red-600',
  info:    'bg-primary/8 text-primary/80',
  neutral: 'bg-warm-100 text-warm-600',
}

export default function Pill({
  children,
  variant = 'neutral',
  icon: Icon = undefined,
  dot = false,
  className = '',
}) {
  const variantCls = VARIANT_STYLES[variant] || VARIANT_STYLES.neutral
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${variantCls} ${className}`}
    >
      {dot && <span className={`h-1 w-1 rounded-full ${dotColor(variant)}`} />}
      {Icon && <Icon size={10} />}
      {children}
    </span>
  )
}

function dotColor(variant) {
  switch (variant) {
    case 'success': return 'bg-emerald-500'
    case 'warning': return 'bg-amber-500'
    case 'danger':  return 'bg-red-500'
    case 'info':    return 'bg-primary/80'
    default:        return 'bg-stone-400'
  }
}
