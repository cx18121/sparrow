import React from 'react'

const variants = {
  active:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  paused:      'bg-amber-50 text-amber-700 border-amber-200',
  draft:       'bg-gray-100 text-gray-600 border-gray-200',
  completed:   'bg-blue-50 text-blue-700 border-blue-200',
  bounced:     'bg-red-50 text-red-700 border-red-200',
  unsubscribed:'bg-gray-100 text-gray-500 border-gray-200',
  shared:      'bg-purple-50 text-purple-700 border-purple-200',
  personal:    'bg-sky-50 text-sky-700 border-sky-200',
  admin:       'bg-primary-50 text-primary border-primary-200',
  editor:      'bg-teal-50 text-teal-700 border-teal-200',
  viewer:      'bg-gray-100 text-gray-600 border-gray-200',
}

export default function Badge({ children, variant = 'draft', className = '' }) {
  const cls = variants[variant] || variants.draft
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${cls} ${className}`}>
      {children}
    </span>
  )
}
