import React, { useEffect, useState } from 'react'
import type { DashboardSendStats } from '../../types/api'

interface SendActivityProps {
  stats: DashboardSendStats | null
  loading: boolean
  dailyMax: number
  monthlyMax: number
}

// Color-code on usage so a user at 90% sees a warning before they hit the
// cap mid-batch. Thresholds match what feels natural: green up to 75%,
// amber 75-95%, red above. Independent of the actual numbers so small and
// large caps look consistent.
function barColor(pct: number): string {
  if (pct >= 95) return 'bg-red-500'
  if (pct >= 75) return 'bg-amber-500'
  return 'bg-emerald-500'
}

// Quota windows are UTC-anchored to match server/lib/rate-limit.ts.
function nextDailyReset(now: Date): Date {
  const next = new Date(now)
  next.setUTCDate(now.getUTCDate() + 1)
  next.setUTCHours(0, 0, 0, 0)
  return next
}
function nextMonthlyReset(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

function formatDailyCountdown(target: Date, now: Date): string {
  const ms = Math.max(0, target.getTime() - now.getTime())
  const totalMin = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours >= 1) return `resets in ${hours}h ${mins}m`
  if (totalMin >= 1) return `resets in ${totalMin} min`
  return 'resets in <1 min'
}

function formatMonthlyCountdown(target: Date, now: Date): string {
  const ms = Math.max(0, target.getTime() - now.getTime())
  const days = Math.floor(ms / (24 * 60 * 60_000))
  if (days >= 1) return `resets in ${days} day${days === 1 ? '' : 's'}`
  const hours = Math.floor(ms / (60 * 60_000))
  if (hours >= 1) return `resets in ${hours}h`
  const mins = Math.floor(ms / 60_000)
  if (mins >= 1) return `resets in ${mins} min`
  return 'resets in <1 min'
}

// Tick once a minute. Cheap; keeps the countdown visibly alive without
// burning a render budget. 60s also matches the granularity of the
// formatted string (we never render seconds), so any faster tick would
// be wasted work.
function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export default function SendActivity({ stats, loading, dailyMax, monthlyMax }: SendActivityProps) {
  const now = useNow()
  const dailyUsed = stats?.sentToday ?? 0
  const monthlyUsed = stats?.sentThisMonth ?? 0
  // Math.max(1, cap) guards against a corrupt config setting cap to 0,
  // which would divide-by-zero into NaN%.
  const dailyPct = Math.min(100, Math.round((dailyUsed / Math.max(1, dailyMax)) * 100))
  const monthlyPct = Math.min(100, Math.round((monthlyUsed / Math.max(1, monthlyMax)) * 100))
  const dailyRemaining = Math.max(0, dailyMax - dailyUsed)
  const monthlyRemaining = Math.max(0, monthlyMax - monthlyUsed)
  const dailyResetHint = formatDailyCountdown(nextDailyReset(now), now)
  const monthlyResetHint = formatMonthlyCountdown(nextMonthlyReset(now), now)

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Send activity</h2>
      </div>
      <div className="rounded-2xl border border-neutral-200 bg-white">
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <QuotaBar
            label="Today"
            used={dailyUsed}
            cap={dailyMax}
            remaining={dailyRemaining}
            pct={dailyPct}
            barColor={barColor(dailyPct)}
            loading={loading}
            resetHint={dailyResetHint}
          />
          <QuotaBar
            label="This month"
            used={monthlyUsed}
            cap={monthlyMax}
            remaining={monthlyRemaining}
            pct={monthlyPct}
            barColor={barColor(monthlyPct)}
            loading={loading}
            resetHint={monthlyResetHint}
          />
        </div>
        <div className="grid grid-cols-3 divide-x divide-neutral-200 border-t border-neutral-200">
          <MiniStat label="Last 7 days" value={stats?.sentLast7Days ?? null} loading={loading} />
          <MiniStat label="All time" value={stats?.sentTotal ?? null} loading={loading} />
          <MiniStat
            label="Replies"
            value={stats?.repliedCount ?? null}
            loading={loading}
            detail={
              stats && stats.sentTotal > 0 && stats.repliedCount > 0
                ? `${Math.round((stats.repliedCount / stats.sentTotal) * 100)}% reply rate`
                : undefined
            }
          />
        </div>
      </div>
    </section>
  )
}

interface QuotaBarProps {
  label: string
  used: number
  cap: number
  remaining: number
  pct: number
  barColor: string
  loading: boolean
  resetHint: string
}

function QuotaBar({ label, used, cap, remaining, pct, barColor, loading, resetHint }: QuotaBarProps) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">{label}</span>
        <span className="text-xs text-muted tabular-nums">
          {loading ? '-' : `${used.toLocaleString()} / ${cap.toLocaleString()}`}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-warm-100">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${barColor}`}
          style={{ width: loading ? '0%' : `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 truncate text-xs text-muted">
        {loading ? ' ' : `${remaining.toLocaleString()} remaining · ${resetHint}`}
      </p>
    </div>
  )
}

interface MiniStatProps {
  label: string
  value: number | null
  loading: boolean
  detail?: string
}

function MiniStat({ label, value, loading, detail }: MiniStatProps) {
  const display = loading || value == null ? '-' : value.toLocaleString()
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">{label}</div>
      <div className="mt-1.5 font-display text-xl font-semibold text-dark tabular-nums">{display}</div>
      {detail && <div className="mt-0.5 truncate text-xs text-muted">{detail}</div>}
    </div>
  )
}
