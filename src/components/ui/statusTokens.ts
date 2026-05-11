export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

type StatusToneClasses = {
  surface: string
  surfaceSoft: string
  border: string
  text: string
  textStrong: string
  icon: string
  dot: string
}

export const STATUS_TONES: Record<StatusTone, StatusToneClasses> = {
  success: {
    surface: 'bg-emerald-50',
    surfaceSoft: 'bg-emerald-50/50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    textStrong: 'text-emerald-900',
    icon: 'text-emerald-600',
    dot: 'bg-emerald-500',
  },
  warning: {
    surface: 'bg-amber-50',
    surfaceSoft: 'bg-amber-50/50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    textStrong: 'text-amber-900',
    icon: 'text-amber-600',
    dot: 'bg-amber-500',
  },
  danger: {
    surface: 'bg-red-50',
    surfaceSoft: 'bg-red-50/50',
    border: 'border-red-200',
    text: 'text-red-600',
    textStrong: 'text-red-900',
    icon: 'text-red-600',
    dot: 'bg-red-500',
  },
  info: {
    surface: 'bg-primary/8',
    surfaceSoft: 'bg-primary/5',
    border: 'border-primary/20',
    text: 'text-primary',
    textStrong: 'text-dark',
    icon: 'text-primary',
    dot: 'bg-primary/80',
  },
  neutral: {
    surface: 'bg-warm-100',
    surfaceSoft: 'bg-warm-50/60',
    border: 'border-warm-200',
    text: 'text-muted',
    textStrong: 'text-dark',
    icon: 'text-muted',
    dot: 'bg-stone-300',
  },
}

export const BADGE_TONES: Record<string, StatusTone> = {
  active: 'info',
  ready: 'success',
  sent: 'success',
  paused: 'warning',
  failed: 'danger',
  draft: 'neutral',
  completed: 'info',
  bounced: 'danger',
  unsubscribed: 'neutral',
  shared: 'info',
  personal: 'info',
  admin: 'info',
  editor: 'info',
  viewer: 'neutral',
}

export const TOAST_TONES: Record<string, StatusTone> = {
  success: 'success',
  error: 'danger',
  warning: 'warning',
  info: 'info',
}

export function getStatusTone(tone: string | undefined): StatusToneClasses {
  return STATUS_TONES[(tone as StatusTone) || 'neutral'] || STATUS_TONES.neutral
}

export function getBadgeTone(variant: string | undefined): StatusToneClasses {
  return getStatusTone(BADGE_TONES[variant || 'draft'] || 'neutral')
}
