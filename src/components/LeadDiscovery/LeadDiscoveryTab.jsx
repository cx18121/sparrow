import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Search, ChevronLeft, ChevronRight, Users, Globe, Building2,
  Sparkles, CheckCircle, AlertCircle,
} from 'lucide-react'
import Modal from '../ui/Modal'
import { apolloSearch, saveLead, revealApolloContact, fetchCompanies as apiFetchCompanies, fetchCampaignOptions } from '../../lib/api'

const PAGE_SIZE = 20
const DISCOVERY_NS = ['stage', 'vertical', 'tech', 'investor', 'signal']
const NS_LABELS = { stage: 'Stage', vertical: 'Sector', tech: 'Tech', investor: 'Investor', signal: 'Signal' }

function CompanyRow({ company, apolloCount, onSelect }) {
  const contactCount = apolloCount
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-100 bg-white/60 px-4 py-3.5 transition-all hover:border-primary/30 hover:bg-white/80">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-dark text-sm">{company.name}</span>
          {company.isHiring && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
              <span className="h-1 w-1 rounded-full bg-emerald-500" />Hiring
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
              className="inline-flex items-center gap-0.5 hover:text-primary"
            >
              <Globe size={10} />{company.domain}
            </a>
          )}
          {company.industry && <span>{company.industry}</span>}
          {company.region && <span>{company.region}</span>}
          {company.stage && <span className="text-slate-400">{company.stage}</span>}
        </div>
        {company.oneLiner && (
          <p className="mt-1.5 text-xs text-muted/80 line-clamp-2">{company.oneLiner}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Users size={11} />
          {apolloCount === null ? 'Loading…' : apolloCount != null ? `${apolloCount} contacts` : ''}
        </span>
        <button
          onClick={() => onSelect(company)}
          className="btn-primary text-xs py-1.5 px-3"
        >
          Search contacts
        </button>
      </div>
    </div>
  )
}

function ContactRow({ preview, email, onSave, saving, saved }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white/60 px-4 py-3 transition-all hover:bg-white/80">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-dark">
          {preview.firstName} {preview.lastNameObfuscated}
        </div>
        <div className="mt-0.5 text-xs text-muted">{preview.title || '—'}</div>
        <div className={`mt-1 text-xs font-medium ${email ? 'text-primary' : 'text-muted'}`}>
          {email === undefined ? 'Loading…' : (email || 'N/A')}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onSave(preview)}
          disabled={saving || saved}
          className={`text-xs py-1.5 px-3 ${saved ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default' : 'btn-primary'}`}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save lead'}
        </button>
      </div>
    </div>
  )
}

export default function LeadDiscoveryTab({ workspaceConfig, onLeadSaved }) {
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState(new Set())
  const selectedTagsRef = useRef(new Set())
  const [tagOptions, setTagOptions] = useState({})
  const [hiringCount, setHiringCount] = useState(null)
  const [isHiring, setIsHiring] = useState(false)
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)

  const [selectedCompany, setSelectedCompany] = useState(null)
  const [apolloResults, setApolloResults] = useState([])
  const [apolloLoading, setApolloLoading] = useState(false)
  const [apolloError, setApolloError] = useState(null)
  const [savedIds, setSavedIds] = useState(new Set())
  const [savingIds, setSavingIds] = useState(new Set())
  const [apolloCounts, setApolloCounts] = useState({})
  const [cachedPreviews, setCachedPreviews] = useState({})
  const [revealedEmails, setRevealedEmails] = useState({})
  const fetchGenRef = useRef(0)

  const fetchCompanies = useCallback(async (cursor = null, overrides = {}) => {
    const gen = ++fetchGenRef.current
    setLoading(true)
    setError(null)
    const query = overrides.search ?? search
    const hiringOnly = overrides.isHiring ?? isHiring
    const tags = overrides.selectedTags ?? selectedTagsRef.current
    try {
      const params = {
        search: query || undefined,
        limit: PAGE_SIZE,
        ...(query && { sort: 'name' }),
        ...(tags.size > 0 && { tags: [...tags].join(',') }),
        ...(hiringOnly && { isHiring: 'true' }),
        ...(cursor && { cursor }),
      }
      const data = await apiFetchCompanies(params)
      if (fetchGenRef.current !== gen) return
      const newItems = data.items ?? []
      setCompanies(cursor ? prev => [...prev, ...newItems] : newItems)
      setNextCursor(data.nextCursor)
      setHasMore(!!data.nextCursor)
      const uncached = newItems.filter(c => !(c.id in apolloCounts))
      if (uncached.length > 0) {
        setApolloCounts(prev => {
          const next = { ...prev }
          uncached.forEach(c => { if (!(c.id in next)) next[c.id] = null })
          return next
        })
        uncached.forEach(async (company) => {
          try {
            const result = await apolloSearch(company.domain, company.id)
            const previews = result.previews ?? []
            setApolloCounts(prev => ({ ...prev, [company.id]: previews.length }))
            setCachedPreviews(prev => ({ ...prev, [company.id]: previews }))
          } catch {
            setApolloCounts(prev => ({ ...prev, [company.id]: 0 }))
          }
        })
      }
    } catch (err) {
      if (fetchGenRef.current !== gen) return
      setError(err.message)
    } finally {
      if (fetchGenRef.current === gen) setLoading(false)
    }
  }, [search, isHiring])

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
  }, [isHiring]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    initialMount.current = false
    fetchCompanies(null)
    fetchCampaignOptions()
      .then(data => {
        setTagOptions(data.tags || {})
        setHiringCount(data.hiringCount ?? null)
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    if (nextCursor) fetchCompanies(nextCursor)
  }, [nextCursor, fetchCompanies])

  const handleCompanySelect = async (company) => {
    setSelectedCompany(company)
    setApolloError(null)
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
      setApolloCounts(prev => ({ ...prev, [company.id]: previews.length }))
      if (!cached) setCachedPreviews(prev => ({ ...prev, [company.id]: previews }))
      // Mark all as loading then reveal in parallel
      setRevealedEmails(prev => {
        const next = { ...prev }
        previews.forEach(p => { if (!(p.id in next)) next[p.id] = undefined })
        return next
      })
      previews.forEach(async (p) => {
        if (!p.hasEmail) { setRevealedEmails(prev => ({ ...prev, [p.id]: null })); return }
        try {
          const result = await revealApolloContact(p.id)
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
      await saveLead({
        companyId: selectedCompany.id,
        contactId: null,
        apolloPersonId: preview.id,
        notes: `Apollo contact: ${preview.firstName} ${preview.lastNameObfuscated} — ${preview.title || 'unknown title'}`,
      })
      setSavedIds(prev => new Set(prev).add(preview.id))
      // Increment the contact count for this company in the local list so the
      // row reflects the new contact without a full refetch.
      setCompanies(prev => prev.map(c =>
        c.id === selectedCompany.id
          ? { ...c, _count: { ...c._count, contacts: (c._count?.contacts ?? 0) + 1 } }
          : c
      ))
      setSelectedCompany(null)
      setApolloResults([])
      setApolloError(null)
      onLeadSaved?.()
    } catch (err) {
      console.error('Failed to save lead', err)
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(preview.id); return n })
    }
  }

  return (
    <div className="page-shell">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Lead Discovery</p>
        <p className="mt-1 text-sm text-muted">Discover YC companies and find contacts to add to your pipeline.</p>
      </div>

      {/* Search & Filters */}
      <div className="page-toolbar mb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="label">Search companies</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()}
                placeholder="Company name, domain, or keyword…"
                className="input pl-9"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:shrink-0">
            <button onClick={doSearch} className="btn-primary h-[38px] px-4" disabled={loading}>
              {loading ? 'Loading…' : 'Search'}
            </button>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsHiring(h => !h)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${isHiring ? 'bg-primary border-primary text-white' : 'border-slate-200 bg-white text-muted hover:border-primary/40 hover:text-dark'}`}
            >
              <span className={`h-2 w-2 rounded-full border ${isHiring ? 'bg-white border-white' : 'border-slate-300'}`} />
              Hiring only{hiringCount != null ? ` (${hiringCount})` : ''}
            </button>
          </div>
          {DISCOVERY_NS.map(ns => {
            const tags = (tagOptions[ns] || []).slice(0, 8)
            if (!tags.length) return null
            return (
              <div key={ns} className="flex flex-wrap items-center gap-2">
                <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/60">{NS_LABELS[ns]}</span>
                {tags.map(({ name, count, namespaced }) => (
                  <button
                    key={namespaced}
                    onClick={() => toggleTag(namespaced)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${selectedTags.has(namespaced) ? 'bg-primary border-primary text-white' : 'border-slate-200 bg-white text-muted hover:border-primary/40 hover:text-dark'}`}
                  >
                    <span className={`h-2 w-2 rounded-full border ${selectedTags.has(namespaced) ? 'bg-white border-white' : 'border-slate-300'}`} />
                    {name}{count != null ? ` (${count})` : ''}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* Results */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading && companies.length === 0 && (
        <div className="flex items-center justify-center py-16 text-sm text-muted gap-2">
          <Sparkles size={14} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && companies.length === 0 && (
        <div className="mx-auto flex max-w-md flex-col items-center py-14 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Search size={18} />
          </div>
          <p className="text-sm font-medium text-dark">
            {search || selectedTags.size > 0 || isHiring ? 'No companies match these filters' : 'Start with a company search'}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted">
            {search || selectedTags.size > 0 || isHiring
              ? 'Broaden the query, remove a filter, or include companies that are not currently hiring.'
              : 'Search by company, domain, keyword, or choose a filter to find outreach targets.'}
          </p>
          {(search || selectedTags.size > 0 || isHiring) && (
            <button
              type="button"
              onClick={() => {
                const clearedTags = new Set()
                setSearch('')
                selectedTagsRef.current = clearedTags
                setSelectedTags(clearedTags)
                setIsHiring(false)
                setCompanies([])
                setNextCursor(null)
                fetchCompanies(null, { search: '', isHiring: false, selectedTags: clearedTags })
              }}
              className="btn-secondary mt-4 text-xs"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {companies.length > 0 && (
        <div className="space-y-2">
          {companies.map(company => (
            <CompanyRow
              key={company.id}
              company={company}
              apolloCount={apolloCounts[company.id]}
              onSelect={handleCompanySelect}
            />
          ))}

          {hasMore && (
            <div className="flex justify-center py-4">
              <button onClick={loadMore} disabled={loading} className="btn-secondary text-xs">
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Company detail modal */}
      <Modal
        open={!!selectedCompany}
        onClose={() => setSelectedCompany(null)}
        title={selectedCompany ? `${selectedCompany.name} — Contact Search` : 'Contacts'}
        size="lg"
      >
        {selectedCompany && (
          <div className="px-6 py-4 space-y-4">
            {selectedCompany.oneLiner && (
              <p className="text-sm text-muted">{selectedCompany.oneLiner}</p>
            )}
            {selectedCompany.website && (
              <a
                href={selectedCompany.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Globe size={11} />{selectedCompany.domain}
              </a>
            )}

            <div className="border-t border-slate-100 pt-4">
              {apolloLoading && (
                <div className="flex items-center justify-center py-8 text-sm text-muted">
                  <Sparkles size={14} className="animate-spin mr-2" /> Searching Apollo for contacts…
                </div>
              )}
              {apolloError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                  <AlertCircle size={14} /> {apolloError}
                </div>
              )}
              {!apolloLoading && !apolloError && apolloResults.length === 0 && (
                <div className="py-6 text-center text-sm text-muted">
                  No contacts found for this company on Apollo.
                </div>
              )}
              {!apolloLoading && !apolloError && apolloResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted/80">
                    {apolloResults.length} contact{apolloResults.length !== 1 ? 's' : ''} found
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
                    <p className="text-xs text-center text-muted pt-2">
                      <CheckCircle size={11} className="inline mr-1 text-emerald-500" />
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
