// Legacy import path. The toast system now lives in a single global
// provider (`src/contexts/ToastContext.tsx`) — this file is preserved only
// because a handful of older modules still reach for `../hooks/useToast`.
// Prefer importing from `../contexts/ToastContext` in new code.
export { useToast } from '../contexts/ToastContext'
export type { ToastInput, ToastItem } from '../contexts/ToastContext'
