import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Search, Users, Globe, Filter,
  CheckCircle, AlertCircle, Loader2, RotateCcw, Shuffle,
} from 'lucide-react'
import Banner from '../ui/Banner'
import EmptyState from '../ui/EmptyState'
import Modal from '../ui/Modal'
import Pill from '../ui/Pill'
import { apolloSearch, saveLead, revealApolloContact, generateEmail, fetchCompanies as apiFetchCompanies, fetchCampaignOptions, resetDiscoverySeen, addCampaignLead } from '../../lib/api'
import { actionKey, runExclusive } from '../../lib/pendingActions'
import {
  discoveryFiltersFromCampaign,
  consumeLeadDiscoveryPrefetch,
  markLeadDiscoveryFetched,
  type DiscoveryRegionFilter,
} from '../../lib/leadDiscoveryPrefetch'
import { useAppData } from '../../contexts/AppDataContext'
import { useToast } from '../../contexts/ToastContext'

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50]
const DISCOVERY_NS = ['vertical', 'tech', 'model', 'investor', 'signal']
// Per-namespace chip cap before the "+N more" expander shows. Mirrors
// CHIP_VISIBLE_CAP in CreateCampaignWizard.tsx — the wizard and the
// in-campaign Leads tab share the chip filter contract.
const CHIP_VISIBLE_CAP = 10

const DISCOVER_CACHE_KEY = 'cf_discover_state'
function discoverCacheKey(campaignId?: string | null) {
  return campaignId ? `${DISCOVER_CACHE_KEY}:${campaignId}` : DISCOVER_CACHE_KEY
}
function readDiscoverCache(campaignId?: string | null) {
  try { return JSON.parse(sessionStorage.getItem(discoverCacheKey(campaignId)) || 'null') } catch { return null }
}
function writeDiscoverCache(state: object, campaignId?: string | null) {
  try { sessionStorage.setItem(discoverCacheKey(campaignId), JSON.stringify(state)) } catch {}
}
function clearDiscoverCache(campaignId?: string | null) {
  try { sessionStorage.removeItem(discoverCacheKey(campaignId)) } catch {}
}
const NS_LABELS = {
  stage: 'Stage',
  vertical: 'Sector',
  tech: 'Tech',
  model: 'Model',
  investor: 'Investor',
  signal: 'Signal',
}

function CompanyRow({ company, onSelect, hasSavedContact, checked, onToggle }) {
  return (
    <div className="dense-list-row flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          onClick={e => e.stopPropagation()}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-primary"
          aria-label={`Select ${company.name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-dark text-sm">{company.name}</span>
            {company.isHiring && <Pill variant="success" dot>Hiring</Pill>}
            {hasSavedContact && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                <CheckCircle size={9} /> Contact saved
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 transition-colors duration-150 hover:text-primary"
              >
                <Globe size={10} />{company.domain}
              </a>
            )}
            {company.industry && <span>{company.industry}</span>}
            {company.region && <span>{company.region}</span>}
            {company.stage && <span className="text-warm-400">{company.stage}</span>}
          </div>
          {company.oneLiner && (
            <p className="mt-1.5 text-xs text-muted/80 line-clamp-2">{company.oneLiner}</p>
          )}
        </div>
      </div>
      <div className="shrink-0">
        <button
          onClick={() => onSelect(company)}
          className="btn-primary text-xs py-1.5 px-3"
        >
          <Users size={11} /> Find contacts
        </button>
      </div>
    </div>
  )
}

function ContactRow({ preview, email, onSave, saving, saved }) {
  return (
    <div className="dense-list-row flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-dark">
          {preview.firstName} {preview.lastNameObfuscated}
        </div>
        <div className="mt-0.5 text-xs text-muted">{preview.title || '-'}</div>
        <div className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${email ? 'text-primary' : 'text-muted'}`}>
          {email === undefined
            ? <><Loader2 size={10} className="animate-spin" />Resolving</>
            : email || 'No email on file'}
        </div>
      </div>
      <div className="shrink-0">
        <button
          onClick={() => onSave(preview)}
          disabled={saving || saved}
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150 disabled:cursor-not-allowed ${
            saved
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : saving
                ? 'border-transparent bg-primary/80 text-warm-50'
                : 'border-transparent bg-primary text-warm-50 hover:brightness-105'
          }`}
        >
          {saving
            ? <><Loader2 size={10} className="animate-spin" />Saving</>
            : saved
              ? 'Saved'
              : 'Save lead'}
        </button>
      </div>
    </div>
  )
}

// Phase 4e folded the legacy /leads route away - this component is now
// only mounted from the workspace Leads sub-tab, which always passes
// activeCampaign + campaignFilters. The standalone (no-campaign) toast
// branches and the "Browsing for X" banner were removed because the
// workspace header makes the campaign context obvious.
type EmailRevealState = string | null | undefined

interface LeadDiscoveryTabProps {
  workspaceConfig: any
  activeCampaign?: { id: string; name: string } | null
  campaignFilters?: any
}

// Backward-compat re-export: tests and other call sites import
// discoveryFiltersFromCampaign from this file by historical convention.
export { discoveryFiltersFromCampaign } from '../../lib/leadDiscoveryPrefetch'

export default function LeadDiscoveryTab({ workspaceConfig, activeCampaign = null, campaignFilters = null }: LeadDiscoveryTabProps) {
  const { leads, refreshLeads } = useAppData()
  const campaignSeed = useMemo(() => discoveryFiltersFromCampaign(campaignFilters), [campaignFilters])
  // Set of apolloPersonIds already saved as UserLeads — used to disable the
  // Save button on previously-saved contacts in the Find-contacts modal,
  // even after a tab switch or a re-open of the same company. Combined with
  // local savedIds (this-session saves before refreshLeads commits) so the
  // button reads correctly during the optimistic window too.
  const persistedSavedApolloIds = useMemo(() => {
    const set = new Set<string>()
    for (const l of leads) {
      if (l.apolloPersonId) set.add(l.apolloPersonId)
    }
    return set
  }, [leads])

  // Companies that already have at least one saved lead — used to show a
  // "contact saved" indicator on the company row without opening the modal.
  const savedCompanyIds = useMemo(() => {
    const set = new Set<string>()
    for (const l of leads) {
      if (l.companyId) set.add(l.companyId)
    }
    return set
  }, [leads])
  const { showToast } = useToast()
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState(() => new Set(campaignSeed.selectedTags))
  const selectedTagsRef = useRef(new Set(campaignSeed.selectedTags))
  const [tagOptions, setTagOptions] = useState({})
  const [stageOptions, setStageOptions] = useState<string[]>([])
  const [hiringCount, setHiringCount] = useState(null)
  const [regionCounts, setRegionCounts] = useState<{ us: number | null; intl: number | null; remote: number | null }>({ us: null, intl: null, remote: null })
  const [isHiring, setIsHiring] = useState(campaignSeed.isHiring)
  const [regionFilter, setRegionFilter] = useState<DiscoveryRegionFilter>(campaignSeed.regionFilter)
  const [stageFilter, setStageFilter] = useState<string | null>(campaignSeed.stageFilter)
  const [batchFilter, setBatchFilter] = useState<string | null>(campaignSeed.batchFilter)
  const [pageSize, setPageSize] = useState<number>(() => {
    const cached = readDiscoverCache(activeCampaign?.id)
    return PAGE_SIZE_OPTIONS.includes(cached?.pageSize) ? cached.pageSize : 20
  })
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tagsOpen, setTagsOpen] = useState(campaignSeed.selectedTags.length > 0)
  const [expandedNs, setExpandedNs] = useState<Set<string>>(() => new Set())
  const [page, setPage] = useState(1)
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [discoveryMeta, setDiscoveryMeta] = useState({ seenTotal: 0, usingFallback: false })
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set())
  const [batchStatus, setBatchStatus] = useState<{
    mode: 'contacts' | 'emails'; total: number; done: number; failed: number; active: boolean
  } | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => { return () => { mountedRef.current = false } }, [])
  const batchTokenRef = useRef(0)

  const [selectedCompany, setSelectedCompany] = useState(null)
  const [apolloResults, setApolloResults] = useState([])
  const [apolloLoading, setApolloLoading] = useState(false)
  const [apolloError, setApolloError] = useState(null)
  const [apolloUsedFallback, setApolloUsedFallback] = useState(false)
  const [savedIds, setSavedIds] = useState(new Set())
  const [savingIds, setSavingIds] = useState(new Set())
  const savingIdsRef = useRef(new Set())
  const [cachedPreviews, setCachedPreviews] = useState({})
  // Bug 05: the per-contact reveal loop inside handleCompanySelect used to
  // skip already-revealed contacts by reading `revealedEmails[p.id]` from
  // the closure, which is a snapshot from the render that produced the
  // current handleCompanySelect binding. State updates queued earlier in
  // the same handler (line 1's "seed previews to undefined" call) hadn't
  // committed yet, so the gate read stale data. We now keep a ref that
  // tracks the live value of the dictionary, write to it synchronously
  // inside every functional setRevealedEmails, and read the gate from
  // the ref so it reflects updates queued in the same tick.
  const [revealedEmails, _setRevealedEmails] = useState<Record<string, EmailRevealState>>({})
  const revealedEmailsRef = useRef<Record<string, EmailRevealState>>({})
  const setRevealedEmails = useCallback((updater: (prev: Record<string, EmailRevealState>) => Record<string, EmailRevealState>) => {
    _setRevealedEmails(prev => {
      const next = updater(prev)
      revealedEmailsRef.current = next
      return next
    })
  }, [])
  const fetchGenRef = useRef(0)

  const fetchCompanies = useCallback(async (cursor = null, overrides: any = {}) => {
    const gen = ++fetchGenRef.current
    setLoading(true)
    setError(null)
    const query = overrides.search ?? search
    const hiringOnly = overrides.isHiring ?? isHiring
    const rf = overrides.regionFilter !== undefined ? overrides.regionFilter : regionFilter
    const stage = overrides.stageFilter !== undefined ? overrides.stageFilter : stageFilter
    const batch = overrides.batchFilter !== undefined ? overrides.batchFilter : batchFilter
    const tags = overrides.selectedTags ?? selectedTagsRef.current
    const append = overrides.append ?? Boolean(cursor)
    try {
      const params = {
        search: query || undefined,
        limit: pageSize,
        random: 'true',
        ...(tags.size > 0 && { tags: [...tags].join(',') }),
        ...(hiringOnly && { isHiring: 'true' }),
        ...(rf && { regionType: rf }),
        ...(stage && { stage }),
        ...(batch && { batch }),
        ...(cursor && { cursor }),
      }
      const data = await apiFetchCompanies(params)
      if (fetchGenRef.current !== gen) return
      const newItems = data.items ?? []
      setCompanies(append && !data.usingFallback
        ? prev => {
            const existing = new Set(prev.map(c => c.id))
            return [...prev, ...newItems.filter(c => !existing.has(c.id))]
          }
        : newItems
      )
      setNextCursor(data.nextCursor)
      setHasMore(!data.usingFallback && newItems.length > 0)
      setDiscoveryMeta({
        seenTotal: data.seenTotal ?? 0,
        usingFallback: data.usingFallback ?? false,
      })
      setLoading(false)
    } catch (err) {
      if (fetchGenRef.current !== gen) return
      setError(err.message)
      setLoading(false)
    }
  }, [search, isHiring, regionFilter, stageFilter, batchFilter, pageSize])

  const doSearch = useCallback(() => {
    setPage(1)
    setCompanies([])
    setNextCursor(null)
    setSelectedCompanyIds(new Set())
    fetchCompanies(null)
  }, [fetchCompanies])

  const toggleTag = useCallback((namespaced) => {
    const next = new Set(selectedTagsRef.current)
    if (next.has(namespaced)) next.delete(namespaced)
    else next.add(namespaced)
    selectedTagsRef.current = next
    setSelectedTags(new Set(next))
    doSearch()
  }, [doSearch])

  const initialMount = useRef(true)
  useEffect(() => {
    if (initialMount.current) return
    doSearch()
  }, [isHiring, regionFilter, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  // Seed Discover filters from the active campaign once filters are available.
  // Runs when campaign ID changes or when filters arrive after campaign is already active.
  // The seed effect itself doesn't fetch — the initial fetch is driven from the
  // mount effect (so the Leads tab is populated as soon as you land on it).
  // Subsequent filter changes that flow through here cascade into a fetch via
  // the [isHiring, regionFilter, pageSize] effect just above.
  const seededCampaignIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeCampaign?.id || !campaignFilters) return
    if (seededCampaignIdRef.current === activeCampaign.id) return
    seededCampaignIdRef.current = activeCampaign.id
    const seeded = discoveryFiltersFromCampaign(campaignFilters)
    const tags = new Set<string>(seeded.selectedTags)
    setRegionFilter(seeded.regionFilter)
    setStageFilter(seeded.stageFilter)
    setBatchFilter(seeded.batchFilter)
    setIsHiring(seeded.isHiring)
    selectedTagsRef.current = tags
    setSelectedTags(tags)
    // Open the tag-filters panel when the campaign has seeded tags. Otherwise
    // those selected pills live behind the collapsed "More filters" affordance
    // and the user can't see that the campaign settings actually applied.
    if (tags.size > 0) setTagsOpen(true)
  }, [activeCampaign?.id, campaignFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    initialMount.current = false
    const cached = activeCampaign?.id ? null : readDiscoverCache()
    if (cached?.companies?.length > 0) {
      setCompanies(cached.companies)
      setNextCursor(cached.nextCursor ?? null)
      setHasMore(cached.hasMore ?? false)
      setDiscoveryMeta(cached.meta || { seenTotal: 0, usingFallback: false })
      setSearch(cached.search || '')
      setIsHiring(cached.isHiring || false)
      setRegionFilter(cached.regionFilter || null)
      setStageFilter(cached.stageFilter || null)
      setBatchFilter(cached.batchFilter || null)
      const tags = new Set<string>(cached.selectedTags || [])
      setSelectedTags(tags)
      selectedTagsRef.current = tags
      setTagOptions(cached.tagOptions || {})
      setStageOptions(cached.stageOptions || [])
      setHiringCount(cached.hiringCount ?? null)
      setRegionCounts(cached.regionCounts || { us: null, intl: null, remote: null })
    } else {
      // Auto-fetch on mount so the Leads tab is populated immediately —
      // campaign filters are already seeded into state via the useState
      // initializers above, so this fetch uses the right filters from the
      // first call. Filter metadata loads in parallel.
      fetchCampaignOptions()
        .then(data => {
          setTagOptions(data.tags || {})
          setStageOptions(data.stages || [])
          setHiringCount(data.hiringCount ?? null)
          setRegionCounts({ us: data.usCount ?? null, intl: data.intlCount ?? null, remote: data.remoteCount ?? null })
        })
        .catch(() => {})
      // If WorkspaceShell already kicked off a background prefetch for this
      // campaign+filter combo, adopt its in-flight (or already-resolved)
      // promise instead of firing a duplicate request. Falls back to a fresh
      // doSearch() if there's no compatible prefetch. In either branch we
      // mark the combo "fetched" so any later WorkspaceShell effect re-run
      // (e.g. campaign-object reference churn) won't fire a redundant
      // background random=true request that would waste seen-state.
      markLeadDiscoveryFetched(activeCampaign?.id, campaignFilters)
      const prefetched = activeCampaign?.id
        ? consumeLeadDiscoveryPrefetch(activeCampaign.id, campaignFilters)
        : null
      if (prefetched) {
        const gen = ++fetchGenRef.current
        setLoading(true)
        prefetched
          .then(data => {
            if (fetchGenRef.current !== gen) return
            const items = data.items ?? []
            setCompanies(items)
            setNextCursor(data.nextCursor ?? null)
            setHasMore(!data.usingFallback && items.length > 0)
            setDiscoveryMeta({ seenTotal: data.seenTotal ?? 0, usingFallback: data.usingFallback ?? false })
            setLoading(false)
          })
          .catch(() => {
            if (fetchGenRef.current !== gen) return
            // Prefetch failed — fall back to a regular search.
            doSearch()
          })
      } else {
        doSearch()
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (companies.length === 0) return
    if (activeCampaign?.id) return
    writeDiscoverCache({
      companies, nextCursor, hasMore, meta: discoveryMeta,
      search, isHiring, regionFilter, stageFilter, batchFilter,
      selectedTags: [...selectedTags],
      tagOptions, stageOptions, hiringCount, regionCounts, pageSize,
    })
  }, [activeCampaign?.id, companies, nextCursor, hasMore, discoveryMeta, search, isHiring, regionFilter, stageFilter, batchFilter, selectedTags, tagOptions, stageOptions, hiringCount, regionCounts, pageSize])

  const loadMore = useCallback(() => {
    fetchCompanies(nextCursor, { append: true })
  }, [nextCursor, fetchCompanies])

  const resetSeen = useCallback(async () => {
    setLoading(true)
    setError(null)
    clearDiscoverCache(activeCampaign?.id)
    try {
      await resetDiscoverySeen()
      setCompanies([])
      setNextCursor(null)
      setSelectedCompanyIds(new Set())
      setDiscoveryMeta({ seenTotal: 0, usingFallback: false })
      await fetchCompanies(null, { append: false })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [fetchCompanies])

  const handleCompanySelect = async (company) => {
    setSelectedCompany(company)
    setApolloError(null)
    setApolloUsedFallback(false)
    setSavedIds(new Set())
    const cached = cachedPreviews[company.id]
    if (cached) {
      setApolloResults(cached.previews ?? cached)
      setApolloUsedFallback(Boolean(cached.usedFallback))
      setApolloLoading(false)
    } else {
      setApolloResults([])
      setApolloLoading(true)
    }
    try {
      const data = cached
        ? { previews: cached.previews ?? cached, usedFallback: Boolean(cached.usedFallback) }
        : await apolloSearch(company.domain, company.id)
      const previews = data.previews || []
      setApolloResults(previews)
      setApolloUsedFallback(Boolean(data.usedFallback))
      if (!cached) setCachedPreviews(prev => ({ ...prev, [company.id]: { previews, usedFallback: Boolean(data.usedFallback) } }))
      setRevealedEmails(prev => {
        const next = { ...prev }
        previews.forEach(p => { if (!(p.id in next)) next[p.id] = undefined })
        return next
      })
      // Only reveal contacts not yet fetched - avoids re-spending Apollo
      // credits on re-open (a null result from a prior attempt counts as
      // "fetched" too). Read the gate from the ref so updates queued
      // earlier in this same tick (the "seed to undefined" set above)
      // are visible to the loop.
      previews.forEach(async (p) => {
        if (!p.hasEmail) { setRevealedEmails(prev => ({ ...prev, [p.id]: null })); return }
        if (revealedEmailsRef.current[p.id] !== undefined) return
        try {
          const result = await revealApolloContact(p.id, company.id, company.domain)
          setRevealedEmails(prev => ({ ...prev, [p.id]: result.contact?.email ?? null }))
        } catch {
          setRevealedEmails(prev => ({ ...prev, [p.id]: null }))
        }
      })
    } catch (err) {
      // Bug 08 fix: a 404 from /api/apollo-search means this company is no
      // longer searchable (deleted or flipped to isVerified=false) but the
      // discover cache is still showing it. Drop the stale cache and the
      // stale row so the user can keep working without a hard refresh.
      if (err?.status === 404) {
        clearDiscoverCache()
        setCompanies(prev => prev.filter(c => c.id !== company.id))
        setApolloError('This company is no longer available. Closing - pick another from the refreshed list.')
        setSelectedCompany(null)
      } else {
        setApolloError(err.message)
      }
    } finally {
      setApolloLoading(false)
    }
  }

  const handleSaveLead = async (preview) => {
    if (!selectedCompany) return
    if (savingIdsRef.current.has(preview.id) || savedIds.has(preview.id) || persistedSavedApolloIds.has(preview.id)) return
    savingIdsRef.current = new Set(savingIdsRef.current).add(preview.id)
    setSavingIds(prev => new Set(prev).add(preview.id))
    setSavedIds(prev => new Set(prev).add(preview.id))
    try {
      const savedLead = await runExclusive(actionKey('save-lead', selectedCompany.id, preview.id), () => saveLead({
        companyId: selectedCompany.id,
        contactId: null,
        apolloPersonId: preview.id,
        notes: `Apollo contact: ${preview.firstName} ${preview.lastNameObfuscated} - ${preview.title || 'unknown title'}`,
      }))
      // Keep modal open so the user can save more people from the same company.
      // Refresh leads so the saved indicator on the row updates.
      refreshLeads()
      if (activeCampaign?.id && savedLead?.id) {
        try {
          await addCampaignLead(activeCampaign.id, savedLead.id)
        } catch (campaignErr) {
          showToast({ type: 'error', title: 'Saved, but not added to campaign', message: campaignErr?.message || 'Please try again.' })
          return
        }
      }
      showToast({
        type: 'success',
        title: activeCampaign
          ? `${preview.firstName} added to ${activeCampaign.name}`
          : `${preview.firstName} saved`,
        message: activeCampaign
          ? 'Go to the Contacts tab to generate a draft.'
          : 'View them in Contacts to generate a draft.',
      })
    } catch (err) {
      setSavedIds(prev => { const n = new Set(prev); n.delete(preview.id); return n })
      showToast({ type: 'error', title: 'Could not save prospect', message: err?.message || 'Please try again.' })
    } finally {
      setSavingIds(prev => {
        const n = new Set(prev)
        n.delete(preview.id)
        savingIdsRef.current = n
        return n
      })
    }
  }

  const handleBatch = useCallback(async (mode: 'contacts' | 'emails') => {
    const toProcess = companies.filter(c => selectedCompanyIds.has(c.id))
    if (!toProcess.length) return
    setSelectedCompanyIds(new Set())
    const myToken = ++batchTokenRef.current
    setBatchStatus({ mode, total: toProcess.length, done: 0, failed: 0, active: true })
    let done = 0, failed = 0
    const seenApolloIds = new Set(persistedSavedApolloIds)
    for (const company of toProcess) {
      if (!mountedRef.current || batchTokenRef.current !== myToken) break
      try {
        const data = await apolloSearch(company.domain, company.id)
        const previews = data.previews || []
        if (!previews.length) throw new Error('no contacts')
        const top = previews[0]
        if (seenApolloIds.has(top.id)) { done++; if (mountedRef.current && batchTokenRef.current === myToken) setBatchStatus(s => s ? { ...s, done } : s); continue }
        seenApolloIds.add(top.id)
        if (top.hasEmail) { try { await revealApolloContact(top.id, company.id, company.domain) } catch {} }
        const savedLead = await saveLead({ companyId: company.id, contactId: null, apolloPersonId: top.id, notes: `Apollo contact: ${top.firstName} ${top.lastNameObfuscated} - ${top.title || 'unknown title'}` })
        if (activeCampaign?.id && savedLead?.id) await addCampaignLead(activeCampaign.id, savedLead.id)
        if (mode === 'emails' && savedLead?.id) await generateEmail({ userLeadId: savedLead.id, templateId: workspaceConfig?.templateId ?? null, save: true }, `batch-${company.id}-${savedLead.id}`)
        done++
      } catch (err: any) {
        failed++
        if (err?.status === 429 && mountedRef.current) { showToast({ type: 'error', title: 'Apollo rate limit hit', message: 'Batch paused. Wait a moment, then try again.' }); break }
      }
      if (mountedRef.current && batchTokenRef.current === myToken) setBatchStatus(s => s ? { ...s, done, failed } : s)
    }
    if (mountedRef.current) refreshLeads()
    if (mountedRef.current && batchTokenRef.current === myToken) {
      setBatchStatus(s => s ? { ...s, active: false } : s)
      setTimeout(() => { if (mountedRef.current) setBatchStatus(null) }, 4000)
    }
  }, [companies, selectedCompanyIds, activeCampaign, workspaceConfig, persistedSavedApolloIds, refreshLeads])

  const hasActiveFilters = search || selectedTags.size > 0 || isHiring || regionFilter || stageFilter

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1">
        <p className="page-eyebrow">Leads</p>
        <p className="text-sm leading-6 text-muted">Browse companies and save contacts into this campaign.</p>
      </header>

      {/* Search & Filters */}
      <div className="surface-panel px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              aria-label="Search companies"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              placeholder="Company name, domain, or keyword…"
              className="input pl-9"
            />
          </div>
          <button
            onClick={doSearch}
            className="btn-primary shrink-0"
            disabled={loading}
          >
            {loading
              ? <><Loader2 size={14} className="animate-spin" />Finding</>
              : <><Shuffle size={14} />Find companies</>}
          </button>
          <button
            onClick={resetSeen}
            className="btn-secondary shrink-0"
            disabled={loading || discoveryMeta.seenTotal === 0}
            title="Clear discovery seen history and start fresh"
          >
            <RotateCcw size={14} />Reset seen
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-muted whitespace-nowrap">Batch:</span>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="select py-1.5 text-xs w-20"
            >
              {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-3 space-y-2 border-t border-warm-200 pt-3">
          {/* Hiring + region filters */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsHiring(h => !h)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-150 whitespace-nowrap ${
                isHiring
                  ? 'border-primary bg-primary text-warm-50'
                  : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/40 hover:text-dark'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isHiring ? 'bg-warm-50' : 'bg-emerald-400'}`} />
              Hiring only{hiringCount != null ? ` (${hiringCount})` : ''}
            </button>
            {([
              { key: 'us', label: 'US only', count: regionCounts.us },
              { key: 'international', label: 'International', count: regionCounts.intl },
              { key: 'remote', label: 'Remote', count: regionCounts.remote },
            ] as const).map(({ key: rf, label, count }) => (
              <button
                key={rf}
                onClick={() => setRegionFilter(prev => prev === rf ? null : rf)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-150 whitespace-nowrap ${
                  regionFilter === rf
                    ? 'border-primary bg-primary text-warm-50'
                    : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/40 hover:text-dark'
                }`}
              >
                {label}{count != null ? ` (${count})` : ''}
              </button>
            ))}
            <button
              onClick={() => setTagsOpen(o => !o)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-150 whitespace-nowrap ${
                tagsOpen || selectedTags.size > 0
                  ? 'border-primary bg-primary text-warm-50'
                  : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/40 hover:text-dark'
              }`}
            >
              <Filter size={11} />
              {tagsOpen ? 'Hide filters' : selectedTags.size > 0 ? `More filters (${selectedTags.size})` : 'More filters'}
            </button>
          </div>

          {/* Stage filter - collapsed with other tag filters */}
          {tagsOpen && stageOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/60">Stage</span>
              {stageOptions.map(stage => (
                <button
                  key={stage}
                  onClick={() => setStageFilter(prev => prev === stage ? null : stage)}
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-150 whitespace-nowrap ${
                    stageFilter === stage
                      ? 'border-primary bg-primary text-warm-50'
                      : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/40 hover:text-dark'
                  }`}
                >
                  {stage}
                </button>
              ))}
            </div>
          )}

          {/* Tag filters - collapsed by default */}
          {tagsOpen && DISCOVERY_NS.map(ns => {
            const allTags = (tagOptions[ns] || []).filter(t => t.count >= 15)
            if (allTags.length < 2) return null
            const expanded = expandedNs.has(ns)
            // Pin selected tags into the visible set so a chip the user has
            // checked never disappears when its namespace is collapsed.
            // The "+ N more" count reflects truly hidden (unselected) tags.
            const visibleByCap = expanded ? allTags : allTags.slice(0, CHIP_VISIBLE_CAP)
            const extraSelected = expanded
              ? []
              : allTags.slice(CHIP_VISIBLE_CAP).filter(t => selectedTags.has(t.namespaced))
            const tags = [...visibleByCap, ...extraSelected]
            const hidden = allTags.length - tags.length
            const toggleExpanded = () => setExpandedNs(prev => {
              const next = new Set(prev)
              if (next.has(ns)) next.delete(ns); else next.add(ns)
              return next
            })
            return (
              <div key={ns} className="flex flex-wrap items-center gap-2">
                <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/60">
                  {NS_LABELS[ns]}
                </span>
                {tags.map(({ name, count, namespaced }) => (
                  <button
                    key={namespaced}
                    onClick={() => toggleTag(namespaced)}
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-150 whitespace-nowrap ${
                      selectedTags.has(namespaced)
                        ? 'border-primary bg-primary text-warm-50'
                        : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/40 hover:text-dark'
                    }`}
                  >
                    {name}{count != null ? ` (${count})` : ''}
                  </button>
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
              </div>
            )
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <Banner variant="danger" icon={AlertCircle} size="sm" className="mb-4">{error}</Banner>
      )}

      {discoveryMeta.usingFallback && (
        <Banner variant="warning" icon={AlertCircle} size="sm" className="mb-4">
          All matching companies have been seen. Showing previously seen companies. Reset seen history to start fresh.
        </Banner>
      )}

      {batchStatus && (
        <div className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm ${batchStatus.active ? 'bg-primary/10 text-primary' : batchStatus.failed > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {batchStatus.active && <Loader2 size={14} className="animate-spin shrink-0" />}
          {batchStatus.active
            ? <>{batchStatus.mode === 'emails' ? 'Generating emails' : 'Saving contacts'}: {batchStatus.done} / {batchStatus.total}… You can keep browsing.</>
            : <>{batchStatus.done} {batchStatus.mode === 'emails' ? 'email draft' : 'contact'}{batchStatus.done !== 1 ? 's' : ''} {batchStatus.mode === 'emails' ? 'generated' : 'saved'}{batchStatus.failed > 0 ? ` · ${batchStatus.failed} skipped` : ' successfully'}.</>
          }
        </div>
      )}

      {/* Initial loading */}
      {loading && companies.length === 0 && (
        <div className="surface-panel flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 size={16} className="animate-spin text-primary/50" />
          Loading companies…
        </div>
      )}

      {/* Empty state */}
      {!loading && companies.length === 0 && (
        <div className="surface-panel mx-auto flex max-w-sm flex-col items-center py-14 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-warm-100 text-muted">
            <Search size={18} />
          </div>
          <p className="text-sm font-semibold text-dark">
            {hasActiveFilters ? 'No companies match' : 'Search to get started'}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted">
            {hasActiveFilters
              ? 'Try broadening your query or removing a filter.'
              : 'Search by company name, domain, or keyword, or pick a filter below.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                const clearedTags = new Set<string>()
                setSearch('')
                selectedTagsRef.current = clearedTags
                setSelectedTags(clearedTags)
                setIsHiring(false)
                setRegionFilter(null)
                setStageFilter(null)
                setBatchFilter(null)
                setCompanies([])
                setNextCursor(null)
                fetchCompanies(null, { search: '', isHiring: false, regionFilter: null, stageFilter: null, batchFilter: null, selectedTags: clearedTags })
              }}
              className="btn-secondary mt-4 text-xs"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {companies.length > 0 && (
        <div className="space-y-2 animate-fade-in">
          {/* Select-all row */}
          <div className="flex items-center gap-3 px-1">
            <input
              type="checkbox"
              checked={selectedCompanyIds.size === companies.length}
              ref={el => { if (el) el.indeterminate = selectedCompanyIds.size > 0 && selectedCompanyIds.size < companies.length }}
              onChange={() => setSelectedCompanyIds(
                selectedCompanyIds.size === companies.length ? new Set() : new Set(companies.map(c => c.id))
              )}
              className="h-4 w-4 cursor-pointer accent-primary"
              aria-label="Select all companies"
            />
            {selectedCompanyIds.size > 0 ? (
              <div className="flex flex-1 items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-dark">{selectedCompanyIds.size} selected</span>
                <button onClick={() => handleBatch('contacts')} disabled={batchStatus?.active} className="btn-secondary text-xs py-1 px-3 disabled:opacity-50">Save contacts</button>
                <button
                  onClick={() => handleBatch('emails')}
                  disabled={batchStatus?.active || !activeCampaign || !workspaceConfig?.templateId}
                  title={!activeCampaign ? 'Requires an active campaign' : !workspaceConfig?.templateId ? 'No template set — pick one in Settings' : undefined}
                  className="btn-primary text-xs py-1 px-3 disabled:opacity-50"
                >Generate emails</button>
                <button onClick={() => setSelectedCompanyIds(new Set())} className="ml-auto text-xs text-muted hover:text-dark">Clear</button>
              </div>
            ) : (
              <span className="text-xs text-muted">{companies.length} companies</span>
            )}
          </div>

          {companies.map(company => (
            <CompanyRow
              key={company.id}
              company={company}
              onSelect={handleCompanySelect}
              hasSavedContact={savedCompanyIds.has(company.id)}
              checked={selectedCompanyIds.has(company.id)}
              onToggle={() => setSelectedCompanyIds(prev => {
                const next = new Set(prev)
                if (next.has(company.id)) next.delete(company.id)
                else next.add(company.id)
                return next
              })}
            />
          ))}

          {hasMore && (
            <div className="flex justify-center pt-2 pb-4">
              <button onClick={loadMore} disabled={loading} className="btn-secondary text-xs">
                {loading
                  ? <><Loader2 size={12} className="animate-spin" />Loading</>
                  : <><Shuffle size={12} />Show another random batch</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Company contact modal */}
      <Modal
        open={!!selectedCompany}
        onClose={() => setSelectedCompany(null)}
        title={selectedCompany ? `${selectedCompany.name}: Contacts` : 'Contacts'}
        size="lg"
      >
        {selectedCompany && (
          <div className="px-6 py-4 space-y-4">
            <div className="flex flex-col gap-1">
              {selectedCompany.oneLiner && (
                <p className="text-sm text-muted">{selectedCompany.oneLiner}</p>
              )}
              {selectedCompany.website && (
                <a
                  href={selectedCompany.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Globe size={11} />{selectedCompany.domain}
                </a>
              )}
            </div>

            <div className="border-t border-warm-200 pt-4">
              {apolloLoading && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
                  <Loader2 size={16} className="animate-spin text-primary/50" />
                  Searching for contacts…
                </div>
              )}
              {apolloError && (
                <Banner variant="danger" icon={AlertCircle} size="sm">{apolloError}</Banner>
              )}
              {!apolloLoading && !apolloError && apolloResults.length === 0 && (
                <EmptyState className="py-6">
                  Apollo had no contacts on file for this company. Try another from the list - small startups often aren&apos;t indexed.
                </EmptyState>
              )}
              {!apolloLoading && !apolloError && apolloResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">
                    {apolloResults.length} contact{apolloResults.length !== 1 ? 's' : ''}
                    {apolloUsedFallback && (
                      <span className="ml-2 normal-case tracking-normal text-muted/70">
                        · no senior matches, showing all
                      </span>
                    )}
                  </p>
                  {apolloResults.map(preview => (
                    <ContactRow
                      key={preview.id}
                      preview={preview}
                      email={revealedEmails[preview.id]}
                      onSave={handleSaveLead}
                      saving={savingIds.has(preview.id)}
                      saved={savedIds.has(preview.id) || persistedSavedApolloIds.has(preview.id)}
                    />
                  ))}
                  {savedIds.size > 0 && (
                    <p className="pt-2 text-center text-xs text-muted">
                      <CheckCircle size={11} className="mr-1 inline text-emerald-500" />
                      {savedIds.size} lead{savedIds.size !== 1 ? 's' : ''} saved this session
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
