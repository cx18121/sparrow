import { useEffect, useMemo, useState } from 'react'
import { Filter } from 'lucide-react'
import { queryAudience } from '../../../lib/api'
import {
  REGION_INTL, REGION_REMOTE, REGION_US,
  type Audience, type RegionFilter,
} from '../../../types/audience'
import { type RoleFamily } from '../../../types/roleFamilies'
import type { CampaignOptions } from '../../../types/api'
import { StepHeader, FilterRow, FilterChip } from '../_shared'
import RolePicker from '../RolePicker'

const SECTOR_NAMESPACES = ['vertical', 'tech', 'model', 'investor', 'signal'] as const
const NS_LABEL: Record<string, string> = {
  vertical: 'Sector',
  tech: 'Tech',
  model: 'Model',
  investor: 'Investor',
  signal: 'Signal',
  stage: 'Stage',
}

const SIGNAL_YC = 'signal:yc-backed'

// Signal tags hidden from the wizard's Signal row. multi-source is an
// internal data-quality signal (set by reconcile-company when a second
// ingest source touches the row); hn-hiring is too narrow a slice to
// surface as a primary filter; stage-inferred marks rows whose stage
// was heuristically derived from investor tags (auditable from the DB
// but not user-facing). They stay in Company.tags but the user no
// longer sees them as filter chips.
const HIDDEN_SIGNAL_TAGS = new Set(['signal:multi-source', 'signal:hn-hiring', 'signal:stage-inferred'])

// Sorts YC batch strings newest-first. Handles both compact ("W26",
// "S25", "F24") and long ("Winter 2026", "Summer 2025") forms by
// extracting the year and a season ordinal. "Unspecified" sinks to
// the bottom.
function sortBatchesNewestFirst(batches: string[]): string[] {
  const seasonRank: Record<string, number> = { W: 0, X: 1, S: 2, F: 3, winter: 0, spring: 1, summer: 2, fall: 3 }
  const score = (raw: string): number => {
    if (/^unspecified$/i.test(raw)) return -Infinity
    const compact = raw.match(/^([WSFX])(\d{2})$/i)
    if (compact) {
      const year = 2000 + parseInt(compact[2], 10)
      return year * 10 + (3 - (seasonRank[compact[1].toUpperCase()] ?? 0))
    }
    const long = raw.match(/(winter|spring|summer|fall)\s+(\d{4})/i)
    if (long) return parseInt(long[2], 10) * 10 + (3 - (seasonRank[long[1].toLowerCase()] ?? 0))
    return 0
  }
  return [...batches].sort((a, b) => score(b) - score(a))
}

// Per-namespace chip cap before the "+N more" expander shows. Set so
// the investor namespace (35 canonical slugs as of 2026-05-11) doesn't
// bury non-top-10 firms behind nothing — without an expander,
// .slice(0, N) makes investors past N unreachable from the wizard.
const CHIP_VISIBLE_CAP = 10

export default function StepFilters({
  audience, includePreviouslySaved, options, defaultTargetRole,
  onAudienceChange, onTogglePrev,
}: {
  audience: Audience
  includePreviouslySaved: boolean
  options: CampaignOptions
  defaultTargetRole: RoleFamily | null
  onAudienceChange: (a: Audience) => void
  onTogglePrev: (v: boolean) => void
}) {
  const [showAllBatches, setShowAllBatches] = useState(false)
  const [expandedNs, setExpandedNs] = useState<Set<string>>(() => new Set())

  const toggleRegion = (r: RegionFilter) =>
    onAudienceChange({
      ...audience,
      region: audience.region.includes(r)
        ? audience.region.filter(x => x !== r)
        : [...audience.region, r],
    })

  const toggleStage = (s: string) =>
    onAudienceChange({
      ...audience,
      stage: audience.stage.includes(s)
        ? audience.stage.filter(x => x !== s)
        : [...audience.stage, s],
    })

  const toggleTag = (namespaced: string) => {
    const has = audience.tags.includes(namespaced)
    const nextTags = has ? audience.tags.filter(t => t !== namespaced) : [...audience.tags, namespaced]
    // Clearing yc-backed must also clear any selected batches —
    // otherwise a stale batch keeps applying silently and the preview
    // drops without a visible reason.
    const next: Audience = { ...audience, tags: nextTags }
    if (namespaced === SIGNAL_YC && has) next.batch = []
    onAudienceChange(next)
  }

  const toggleBatch = (batch: string) =>
    onAudienceChange({
      ...audience,
      batch: audience.batch.includes(batch)
        ? audience.batch.filter(x => x !== batch)
        : [...audience.batch, batch],
    })

  const clearBatch = () => onAudienceChange({ ...audience, batch: [] })

  const ycSelected = audience.tags.includes(SIGNAL_YC)
  const sortedBatches = useMemo(() => sortBatchesNewestFirst(options.batches || []), [options.batches])
  const visibleBatches = showAllBatches ? sortedBatches : sortedBatches.slice(0, 8)

  return (
    <section className="space-y-8">
      {/* Primary question: what role is the user looking for? Contact-side
          targeting, not a company-pool filter — sits above the audience block
          so the wizard reads role → companies → template → send. */}
      <RolePicker
        value={audience.targetRole}
        defaultValue={defaultTargetRole}
        onChange={role => onAudienceChange({ ...audience, targetRole: role })}
      />

      <StepHeader
        icon={Filter}
        title="Who should Sparrow find?"
      />
      <div className="mt-2 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Filter pills */}
        <div className="space-y-5">
          <FilterRow label="Region">
            <FilterChip active={audience.region.includes(REGION_US)} onClick={() => toggleRegion(REGION_US)}>US</FilterChip>
            <FilterChip active={audience.region.includes(REGION_INTL)} onClick={() => toggleRegion(REGION_INTL)}>International</FilterChip>
            <FilterChip active={audience.region.includes(REGION_REMOTE)} onClick={() => toggleRegion(REGION_REMOTE)}>Remote</FilterChip>
          </FilterRow>

          <FilterRow label="Hiring">
            <FilterChip
              active={audience.isHiring === true}
              onClick={() => onAudienceChange({ ...audience, isHiring: audience.isHiring ? null : true })}
              dot
            >
              Currently hiring
            </FilterChip>
          </FilterRow>

          {(options.stages || []).length > 0 && (
            <FilterRow label="Stage">
              {(options.stages || []).map(stage => (
                <FilterChip
                  key={stage}
                  active={audience.stage.includes(stage)}
                  onClick={() => toggleStage(stage)}
                >
                  {stage}
                </FilterChip>
              ))}
            </FilterRow>
          )}

          {SECTOR_NAMESPACES.map(ns => {
            const allTags = (options.tags?.[ns] || [])
              .filter(t => t.count >= 15 && !HIDDEN_SIGNAL_TAGS.has(t.namespaced))
            if (allTags.length < 2) return null
            const expanded = expandedNs.has(ns)
            const selected = new Set(audience.tags)
            // Pin selected tags into the visible set so a chip the user
            // has checked never disappears when its namespace is
            // collapsed. The "+ N more" count reflects truly hidden
            // (unselected) tags.
            const visibleByCap = expanded ? allTags : allTags.slice(0, CHIP_VISIBLE_CAP)
            const extraSelected = expanded
              ? []
              : allTags.slice(CHIP_VISIBLE_CAP).filter(t => selected.has(t.namespaced))
            const tags = [...visibleByCap, ...extraSelected]
            const hidden = allTags.length - tags.length
            const toggleExpanded = () => setExpandedNs(prev => {
              const next = new Set(prev)
              if (next.has(ns)) next.delete(ns); else next.add(ns)
              return next
            })
            const showBatchPicker = ns === 'signal' && ycSelected && sortedBatches.length > 0
            return (
              <div key={ns}>
                <FilterRow label={NS_LABEL[ns] || ns}>
                  {tags.map(t => (
                    <FilterChip
                      key={t.namespaced}
                      active={audience.tags.includes(t.namespaced)}
                      onClick={() => toggleTag(t.namespaced)}
                    >
                      {t.name}
                    </FilterChip>
                  ))}
                  {(hidden > 0 || expanded) && allTags.length > CHIP_VISIBLE_CAP && (
                    <button
                      type="button"
                      onClick={toggleExpanded}
                      className="text-[11px] font-medium text-muted hover:text-dark"
                      aria-expanded={expanded}
                    >
                      {expanded ? 'Show less' : `+ ${hidden} more`}
                    </button>
                  )}
                </FilterRow>
                {showBatchPicker && (
                  <div className="mt-2 ml-[76px] flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/60">
                      Batch
                    </span>
                    <FilterChip active={audience.batch.length === 0} onClick={clearBatch}>
                      Any
                    </FilterChip>
                    {visibleBatches.map(b => (
                      <FilterChip key={b} active={audience.batch.includes(b)} onClick={() => toggleBatch(b)}>
                        {b}
                      </FilterChip>
                    ))}
                    {!showAllBatches && sortedBatches.length > 8 && (
                      <button
                        type="button"
                        onClick={() => setShowAllBatches(true)}
                        className="text-[11px] font-medium text-muted hover:text-dark"
                      >
                        + {sortedBatches.length - 8} more
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          <div className="border-t border-warm-200 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includePreviouslySaved}
                onChange={e => onTogglePrev(e.target.checked)}
                className="mt-1 rounded border-warm-300"
              />
              <span>
                <span className="block text-sm font-medium text-dark">
                  Include leads I've already saved in past campaigns
                </span>
                <span className="block text-xs text-muted">
                  Off by default - Sparrow normally skips anyone you've already saved to avoid double-emailing.
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Live audience preview */}
        <AudiencePreview
          audience={audience}
          excludePreviouslySaved={!includePreviouslySaved}
        />
      </div>
    </section>
  )
}

function AudiencePreview({
  audience, excludePreviouslySaved,
}: {
  audience: Audience
  excludePreviouslySaved: boolean
}) {
  const [count, setCount] = useState<number | null>(null)
  const [sample, setSample] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [errored, setErrored] = useState(false)

  // Debounced query - re-issue 350ms after the audience changes.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErrored(false)
    const handle = window.setTimeout(() => {
      queryAudience(audience, excludePreviouslySaved)
        .then(res => {
          if (cancelled) return
          setCount(res.count)
          setSample(res.sample)
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setErrored(true)
          setLoading(false)
        })
    }, 350)
    return () => { cancelled = true; window.clearTimeout(handle) }
  }, [
    audience.tags.join(','),
    audience.region.join(','),
    audience.stage.join(','),
    audience.batch.join(','),
    audience.isHiring,
    excludePreviouslySaved,
  ])

  const display = errored
    ? '-'
    : loading && count == null
      ? '…'
      : count == null
        ? '0'
        : `~${count}`

  return (
    <aside className="rounded-2xl border border-warm-200 bg-panel px-5 py-4 lg:sticky lg:top-24 self-start">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Audience preview</p>
      <p className="mt-3 font-display text-[2rem] font-semibold leading-none text-dark tabular-nums">
        {display}
      </p>
      <p className="mt-1 text-xs text-muted">
        {errored ? 'Could not load preview' : count === 1 ? 'company matches' : 'companies match'}
      </p>
      <p className="mt-3 text-[11px] leading-5 text-muted/70">
        Live count from the verified company pool
        {excludePreviouslySaved ? ', minus anyone you already saved' : ''}.
      </p>
      {sample.length > 0 && (
        <>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Sample</p>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {sample.map(name => (
              <li key={name} className="truncate">{name}</li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}
