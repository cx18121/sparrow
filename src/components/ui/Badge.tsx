import React from 'react'
import { getBadgeTone } from './statusTokens'

export default function Badge({ children, variant = 'draft', className = '' }) {
  const tone = getBadgeTone(variant)
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium capitalize ${tone.text} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${tone.dot}`} />
      {children}
    </span>
  )
}
