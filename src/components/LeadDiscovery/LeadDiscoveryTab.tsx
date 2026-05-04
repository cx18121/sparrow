import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Search, Users, Globe, Filter,
  CheckCircle, AlertCircle, Loader2, RotateCcw, Shuffle, Mail, X,
} from 'lucide-react'
import Banner from '../ui/Banner'
import EmptyState from '../ui/EmptyState'
import Modal from '../ui/Modal'
import Pill from '../ui/Pill'
import Toast from '../ui/Toast'
import { apolloSearch, saveLead, revealApolloContact, fetchCompanies as apiFetchCompanies, fetchCampaignOptions, resetDiscoverySeen, addCampaignLead } from '../../lib/api'
import { useAppData } from '../../contexts/AppDataContext'
import { useToast } from '../../hooks/useToast'

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50]
const DISCOVERY_NS = ['stage', 'vertical', 'tech', 'model', 'investor', 'signal']

const DISCOVER_CACHE_KEY = 'cf_discover_state'
function readDiscoverCache() {
  try { return JSON.parse(sessionStorage.getItem(DISCOVER_CACHE_KEY) || 'null') } catch { return null }
}
function writeDiscoverCache(state: object) {
  try { sessionStorage.setItem(DISCOVER_CACHE_KEY, JSON.stringify(state)) } catch {}
}
function clearDiscoverCache() {
  try { sessionStorage.removeItem(DISCOVER_CACHE_KEY) } catch {}
}
const NS_LABELS = {
  stage: 'Stage',
  vertical: 'Sector',
  tech: 'Tech',
  model: 'Model',
  investor: 'Investor',
  signal: 'Signal',
}

function CompanyRow({ company, onSelect }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-warm-200 bg-warm-50 px-4 py-3.5 transition-all duration-150 hover:border-primary/30 hover:shadow-[0_2px_12px_rgba(44,31,16,0.06)]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-dark text-sm">{company.name}</span>
          {company.isHiring && <Pill variant="success" dot>Hiring</Pill>}
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-warm-200 bg-warm-50 px-4 py-3 transition-all duration-150 hover:border-warm-300 hover:shadow-[0_1px_6px_rgba(44,31,16,0.05)]">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-dark">
          {preview.firstName} {preview.lastNameObfuscated}
        </div>
        <div className="mt-0.5 text-xs text-muted">{preview.title || '—'}</div>
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
                ? 'border-transparent bg-primary/80 text-white'
                : 'border-transparent bg-primary text-white hover:brightness-105'
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

export default function LeadDiscoveryTab({ workspaceConfig, onNavigate = null, activeCampaign = null, onExitCampaign = null, campaignFilters = null }) {
  const { refreshLeads } = useAppData()
  const { toast, setToast } = useToast()
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState(new Set())
  const selectedTagsRef = useRef(new Set())
  const [tagOptions, setTagOptions] = useState({})
  const [hiringCount, setHiringCount] = useState(null)
  const [regionCounts, setRegionCounts] = useState<{ us: number | null; intl: number | null; remote: number | null }>({ us: null, intl: null, remote: null })
  const [isHiring, setIsHiring] = useState(false)
  const [regionFilter, setRegionFilter] = useState<'us' | 'international' | 'remote' | null>(null)
  const [pageSize, setPageSize] = useState<number>(() => {
    const cached = readDiscoverCache()
    return PAGE_SIZE_OPTIONS.includes(cached?.pageSize) ? cached.pageSize : 20
  })
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [discoveryMeta, setDiscoveryMeta] = useState({ seenTotal: 0, usingFallback: false })

  const [selectedCompany, setSelectedCompany] = useState(null)
  const [apolloResults, setApolloResults] = useState([])
  const [apolloLoading, setApolloLoading] = useState(false)
  const [apolloError, setApolloError] = useState(null)
  const [savedIds, setSavedIds] = useState(new Set())
  const [savingIds, setSavingIds] = useState(new Set())
  const [cachedPreviews, setCachedPreviews] = useState({})
  const [revealedEmails, setRevealedEmails] = useState({})
  const fetchGenRef = useRef(0)

  const fetchCompanies = useCallback(async (cursor = null, overrides: any = {}) => {
    const gen = ++fetchGenRef.current
    setLoading(true)
    setError(null)
    const query = overrides.search ?? search
    const hiringOnly = overrides.isHiring ?? isHiring
    const rf = overrides.regionFilter !== undefined ? overrides.regionFilter : regionFilter
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
  }, [search, isHiring, regionFilter, pageSize])

  const doSearch = useCallback(() => {
    setPage(1)
    setCompanies([])
    setNextCursor(null)
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
  const seededCampaignIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeCampaign?.id || !campaignFilters) return
    if (seededCampaignIdRef.current === activeCampaign.id) return
    seededCampaignIdRef.current = activeCampaign.id
    const regionMap: Record<string, 'us' | 'international' | 'remote'> = {
      __US__: 'us', __INTL__: 'international', __REMOTE__: 'remote',
    }
    const rf = campaignFilters.filterRegion ? (regionMap[campaignFilters.filterRegion] ?? null) : null
    const tags = new Set<string>(campaignFilters.filterTags || [])
    setRegionFilter(rf)
    setIsHiring(Boolean(campaignFilters.filterIsHiring))
    selectedTagsRef.current = tags
    setSelectedTags(tags)
    fetchCompanies(null, { regionFilter: rf, isHiring: Boolean(campaignFilters.filterIsHiring), selectedTags: tags })
  }, [activeCampaign?.id, campaignFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    initialMount.current = false
    const cached = readDiscoverCache()
    if (cached?.companies?.length > 0) {
      setCompanies(cached.companies)
      setNextCursor(cached.nextCursor ?? null)
      setHasMore(cached.hasMore ?? false)
      setDiscoveryMeta(cached.meta || { seenTotal: 0, usingFallback: false })
      setSearch(cached.search || '')
      setIsHiring(cached.isHiring || false)
      setRegionFilter(cached.regionFilter || null)
      const tags = new Set<string>(cached.selectedTags || [])
      setSelectedTags(tags)
      selectedTagsRef.current = tags
      setTagOptions(cached.tagOptions || {})
      setHiringCount(cached.hiringCount ?? null)
      setRegionCounts(cached.regionCounts || { us: null, intl: null, remote: null })
    } else {
      fetchCompanies(null)
      fetchCampaignOptions()
        .then(data => {
          setTagOptions(data.tags || {})
          setHiringCount(data.hiringCount ?? null)
          setRegionCounts({ us: data.usCount ?? null, intl: data.intlCount ?? null, remote: data.remoteCount ?? null })
        })
        .catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (companies.length === 0) return
    writeDiscoverCache({
      companies, nextCursor, hasMore, meta: discoveryMeta,
      search, isHiring, regionFilter,
      selectedTags: [...selectedTags],
      tagOptions, hiringCount, regionCounts, pageSize,
    })
  }, [companies, nextCursor, hasMore, discoveryMeta, search, isHiring, regionFilter, selectedTags, tagOptions, hiringCount, regionCounts, pageSize])

  const loadMore = useCallback(() => {
    fetchCompanies(nextCursor, { append: true })
  }, [nextCursor, fetchCompanies])

  const resetSeen = useCallback(async () => {
    setLoading(true)
    setError(null)
    clearDiscoverCache()
    try {
      await resetDiscoverySeen()
      setCompanies([])
      setNextCursor(null)
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
    setSavedIds(new Set())
    const cached = cachedPreviews[company.id]
    if (cached) {
      setApolloResults(cached)
      setApolloLoading(false)
    } else {
      setApolloResults([])
      setApolloLoading(true)
    }
    try {
      const data = cached ? { previews: cached } : await apolloSearch(company.domain, company.id)
      const previews = data.previews || []
      setApolloResults(previews)
      if (!cached) setCachedPreviews(prev => ({ ...prev, [company.id]: previews }))
      setRevealedEmails(prev => {
        const next = { ...prev }
        previews.forEach(p => { if (!(p.id in next)) next[p.id] = undefined })
        return next
      })
      // Only reveal contacts not yet fetched — avoids re-spending Apollo credits on re-open
      previews.forEach(async (p) => {
        if (!p.hasEmail) { setRevealedEmails(prev => ({ ...prev, [p.id]: null })); return }
        if (revealedEmails[p.id] !== undefined) return
        try {
          const result = await revealApolloContact(p.id, company.id, company.domain)
          setRevealedEmails(prev => ({ ...prev, [p.id]: result.contact?.email ?? null }))
        } catch {
          setRevealedEmails(prev => ({ ...prev, [p.id]: null }))
        }
      })
    } catch (err) {
      setApolloError(err.message)
    } finally {
      setApolloLoading(false)
    }
  }

  const handleSaveLead = async (preview) => {
    if (!selectedCompany) return
    setSavingIds(prev => new Set(prev).add(preview.id))
    try {
      const savedLead = await saveLead({
        companyId: selectedCompany.id,
        contactId: null,
        apolloPersonId: preview.id,
        notes: `Apollo contact: ${preview.firstName} ${preview.lastNameObfuscated} — ${preview.title || 'unknown title'}`,
      })
      // Always refresh leads and close modal — even if campaign add fails
      setSavedIds(prev => new Set(prev).add(preview.id))
      setSelectedCompany(null)
      setApolloResults([])
      setApolloError(null)
      refreshLeads()
      if (activeCampaign?.id && savedLead?.id) {
        try {
          await addCampaignLead(activeCampaign.id, savedLead.id)
        } catch (campaignErr) {
          setToast({ type: 'error', title: 'Saved, but not added to campaign', message: campaignErr?.message || 'Please try again.' })
          return
        }
      }
      if (activeCampaign) {
        setToast({
          type: 'success',
          title: `${preview.firstName} added to ${activeCampaign.name}`,
          message: 'Continue browsing or open Campaigns to see prospects.',
          action: onNavigate ? {
            label: 'Open Campaigns',
            onClick: () => { onNavigate('campaigns'); setToast(null) },
          } : null,
        })
      } else {
        setToast({
          type: 'success',
          title: `${preview.firstName} saved`,
          message: 'Generate an email from Contacts.',
          action: onNavigate ? {
            label: 'Go to Contacts',
            onClick: () => { onNavigate('contacts'); setToast(null) },
          } : null,
        })
      }
    } catch (err) {
      setToast({ type: 'error', title: 'Could not save prospect', message: err?.message || 'Please try again.' })
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(preview.id); return n })
    }
  }

  const hasActiveFilters = search || selectedTags.size > 0 || isHiring || regionFilter

  return (
    <div className="page-shell">
      <Toast toast={toast} onClose={() => setToast(null)} />
      {activeCampaign && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Mail size={14} />
            Browsing for <span className="font-semibold">{activeCampaign.name}</span>
            <span className="text-primary/60 font-normal">— contacts you save go directly into this campaign.</span>
          </div>
          {onExitCampaign && (
            <button type="button" onClick={onExitCampaign} className="shrink-0 rounded-full p-1 text-primary/50 transition-colors hover:bg-primary/10 hover:text-primary" title="Exit campaign mode">
              <X size={13} />
            </button>
          )}
        </div>
      )}
      <div className="mb-5">
        <p className="mt-1 text-sm leading-6 text-muted">Browse companies and find contacts to add to your pipeline.</p>
      </div>

      {/* Search & Filters */}
      <div className="page-toolbar mb-4">
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

        <div className="mt-3 space-y-2">
          {/* Hiring + region filters */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsHiring(h => !h)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-150 whitespace-nowrap ${
                isHiring
                  ? 'border-primary bg-primary text-white'
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
                    ? 'border-primary bg-primary text-white'
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
                  ? 'border-primary bg-primary text-white'
                  : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/40 hover:text-dark'
              }`}
            >
              <Filter size={11} />
              {tagsOpen ? 'Hide filters' : selectedTags.size > 0 ? `More filters (${selectedTags.size})` : 'More filters'}
            </button>
          </div>

          {/* Tag filters — collapsed by default */}
          {tagsOpen && DISCOVERY_NS.map(ns => {
            const tags = (tagOptions[ns] || []).filter(t => t.count >= 15).slice(0, 8)
            if (tags.length < 2) return null
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
                        ? 'border-primary bg-primary text-white'
                        : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/40 hover:text-dark'
                    }`}
                  >
                    {name}{count != null ? ` (${count})` : ''}
                  </button>
                ))}
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

      {/* Initial loading */}
      {loading && companies.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 size={16} className="animate-spin text-primary/50" />
          Loading companies…
        </div>
      )}

      {/* Empty state */}
      {!loading && companies.length === 0 && (
        <div className="mx-auto flex max-w-sm flex-col items-center py-14 text-center">
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
                const clearedTags = new Set()
                setSearch('')
                selectedTagsRef.current = clearedTags
                setSelectedTags(clearedTags)
                setIsHiring(false)
                setRegionFilter(null)
                setCompanies([])
                setNextCursor(null)
                fetchCompanies(null, { search: '', isHiring: false, regionFilter: null, selectedTags: clearedTags })
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
          {companies.map(company => (
            <CompanyRow
              key={company.id}
              company={company}
              onSelect={handleCompanySelect}
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
                <EmptyState className="py-6">No contacts found for this company.</EmptyState>
              )}
              {!apolloLoading && !apolloError && apolloResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">
                    {apolloResults.length} contact{apolloResults.length !== 1 ? 's' : ''}
                  </p>
                  {apolloResults.map(preview => (
                    <ContactRow
                      key={preview.id}
                      preview={preview}
                      email={revealedEmails[preview.id]}
                      onSave={handleSaveLead}
                      saving={savingIds.has(preview.id)}
                      saved={savedIds.has(preview.id)}
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
