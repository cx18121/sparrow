import React from 'react'

// Two-arc bird-in-flight silhouette — the placeholder brand mark used in the
// hero flock, the brand badge, and the founder signature. Treated as an icon
// (sets `currentColor`), so it tints with whatever ink the parent carries.
//
// Until the real hero illustration lands at `src/assets/landing-hero.png`,
// the same shape is multiplied in the hero background. See `landing.css`
// `.lp-flock` for the positions.
export function SparrowMark({
  size = 16,
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
      viewBox="0 0 24 12"
      width={size}
      height={(size * 12) / 24}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <path d="M2 8 C 6 2, 8 5, 12 5 C 16 5, 18 2, 22 8" />
    </svg>
  )
}
