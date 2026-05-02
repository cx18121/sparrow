import React from 'react'

const variants = {
  active:       'text-emerald-600',
  ready:        'text-emerald-600',
  sent:         'text-emerald-600',
  paused:       'text-amber-600',
  failed:       'text-red-600',
  draft:        'text-muted',
  completed:    'text-primary',
  bounced:      'text-red-500',
  unsubscribed: 'text-muted',
  shared:       'text-accent-600',
  personal:     'text-primary',
  admin:        'text-primary',
  editor:       'text-primary-400',
  viewer:       'text-muted',
}

const dots = {
  active:       'bg-emerald-500',
  ready:        'bg-emerald-500',
  sent:         'bg-emerald-500',
  paused:       'bg-amber-500',
  failed:       'bg-red-500',
  draft:        'bg-stone-300',
  completed:    'bg-primary',
  bounced:      'bg-red-500',
  unsubscribed: 'bg-stone-300',
  shared:       'bg-accent-400',
  personal:     'bg-primary',
  admin:        'bg-primary',
  editor:       'bg-primary-300',
  viewer:       'bg-stone-300',
}

export default function Badge({ children, variant = 'draft', className = '' }) {
  const textCls = variants[variant] || variants.draft
  const dotCls = dots[variant] || dots.draft
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${textCls} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotCls}`} />
      {children}
    </span>
  )
}
