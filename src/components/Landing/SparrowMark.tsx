import React from 'react'

// Two distinct marks. SparrowLogo is the official brand badge (green
// circle + rotated Send icon, matching public/favicon.svg and
// Sidebar.tsx:122). SparrowBird is a decorative two-arc silhouette used
// only in the hero flock placeholder — a stand-in for the AI hero
// illustration per BRIEF.md §6, never as a brand mark.

export function SparrowLogo({
  size = 32,
  className,
  title,
}: {
  size?: number
  className?: string
  title?: string
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="16" cy="16" r="16" fill="#557A57" />
      <g transform="rotate(-12, 16, 16)">
        <g
          transform="translate(9, 9) scale(0.583)"
          stroke="#FDFAF5"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          <path d="M22 2L11 13" />
          <path d="M22 2L15 22L11 13L2 9L22 2Z" />
        </g>
      </g>
    </svg>
  )
}

export function SparrowBird({
  size = 16,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 12"
      width={size}
      height={(size * 12) / 24}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 8 C 6 2, 8 5, 12 5 C 16 5, 18 2, 22 8" />
    </svg>
  )
}

// Back-compat alias so existing imports of SparrowMark keep working
// during the reshape; the active spots are migrating to SparrowLogo /
// SparrowBird explicitly.
export const SparrowMark = SparrowBird
