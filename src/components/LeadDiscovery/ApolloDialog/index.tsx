import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Globe, Loader2 } from 'lucide-react'
import Modal from '../../ui/Modal'
import Banner from '../../ui/Banner'
import EmptyState from '../../ui/EmptyState'
import PersonRow from './PersonRow'
import { useToast } from '../../../contexts/ToastContext'
import { addCampaignLead, apolloSearch, revealApolloContact, saveLead } from '../../../lib/api'
import { actionKey, runExclusive } from '../../../lib/pendingActions'
import type { ApolloPreview } from '../../../types/api'
import type { ApolloCache } from './_apolloCache'

interface DialogCompany {
  id: string
  name: string
  domain?: string
  website?: string
  oneLiner?: string
}

interface ApolloDialogProps {
  company: DialogCompany
  apolloRole: string | null
  activeCampaign: { id: string; name: string } | null
  persistedSavedApolloIds: Set<string>
  cache: ApolloCache
  onCacheUpdate: (updater: (prev: ApolloCache) => ApolloCache) => void
  onClose: () => void
  onLeadSaved: () => void
  onCompanyNoLongerAvailable: (companyId: string) => void
}

export default function ApolloDialog({
  company,
  apolloRole,
  activeCampaign,
  persistedSavedApolloIds,
  cache,
  onCacheUpdate,
  onClose,
  onLeadSaved,
  onCompanyNoLongerAvailable,
}: ApolloDialogProps) {
  const { showToast } = useToast()

  // Cache is the single source of truth for previews + revealed emails so
  // close+reopen never re-spends Apollo credits. The dialog only owns
  // transient in-session concerns (loading flag, error, optimistic saves).
  const cachedBundle = cache.previews[company.id]
  const previews = cachedBundle?.previews ?? []
  const usedFallback = cachedBundle?.usedFallback ?? false

  const [apolloLoading, setApolloLoading] = useState<boolean>(() => !cachedBundle)
  const [apolloError, setApolloError] = useState<string | null>(null)
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set())
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set())
  const savingIdsRef = useRef<Set<string>>(new Set())

  // mountedRef guards setState on dialog-local state after unmount. Cache
  // writes via onCacheUpdate are always safe (parent state) so a close mid-
  // fetch/mid-reveal still populates the cache for instant reopen.
  //
  // mountedRef must be re-set to true on every effect run — under React 18+
  // StrictMode the effect runs twice in dev (mount → fake-unmount → remount),
  // and without the explicit re-set the ref stays false after the simulated
  // unmount and every guarded setState silently no-ops.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // StrictMode runs effects twice in dev (mount → fake-unmount → remount).
  // The pre-extract code did the Apollo work inside an event handler, which
  // fires once per click; moving it to a mount effect would double every
  // apolloSearch + revealApolloContact in dev (real Apollo credits when
  // running against prod creds). hasRunRef gates the second invocation so
  // we keep the original "once per dialog open" cost profile.
  const hasRunRef = useRef(false)

  useEffect(() => {
    if (hasRunRef.current) return
    hasRunRef.current = true
    // Cache writes target parent state and must run to completion even after
    // the dialog unmounts — otherwise closing mid-fetch would leave the cache
    // unpopulated and a reopen would re-spend an Apollo credit. Dialog-local
    // setState calls are guarded by mountedRef so they no-op safely instead.
    const run = async () => {
      let working = cachedBundle?.previews ?? []
      if (!cachedBundle) {
        try {
          const data = await apolloSearch(company.domain ?? '', company.id, apolloRole)
          working = data.previews ?? []
          onCacheUpdate(prev => ({
            ...prev,
            previews: {
              ...prev.previews,
              [company.id]: { previews: working, usedFallback: Boolean(data.usedFallback) },
            },
          }))
        } catch (err) {
          const e = err as { status?: number; message?: string }
          if (e?.status === 404) {
            onCompanyNoLongerAvailable(company.id)
            onClose()
            return
          }
          if (mountedRef.current) setApolloError(e?.message ?? 'Unknown error')
          return
        } finally {
          if (mountedRef.current) setApolloLoading(false)
        }
      } else if (mountedRef.current) {
        setApolloLoading(false)
      }

      // Reveal emails for each preview that hasn't already been attempted.
      // Gate reads the cache snapshot captured at effect mount — same-effect
      // race window is acceptable (matches pre-extract revealedEmailsRef
      // behavior, which also resolved against the ref captured at handler
      // creation time). Cross-mount races stay rare because previews tend
      // to load faster than a user can close+reopen.
      for (const p of working) {
        if (!p.hasEmail) {
          onCacheUpdate(prev => ({
            ...prev,
            revealedEmails: { ...prev.revealedEmails, [p.id]: null },
          }))
          continue
        }
        if (cache.revealedEmails[p.id] !== undefined) continue
        try {
          const result = await revealApolloContact(p.id, company.id, company.domain ?? '')
          onCacheUpdate(prev => ({
            ...prev,
            revealedEmails: { ...prev.revealedEmails, [p.id]: result.contact?.email ?? null },
          }))
        } catch {
          onCacheUpdate(prev => ({
            ...prev,
            revealedEmails: { ...prev.revealedEmails, [p.id]: null },
          }))
        }
      }
    }
    void run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Effect runs once per dialog mount. Parent keys ApolloDialog by company.id
  // so a different company gets a fresh mount with its own effect.

  const handleSaveLead = useCallback(async (preview: ApolloPreview) => {
    if (savingIdsRef.current.has(preview.id) || savedIds.has(preview.id) || persistedSavedApolloIds.has(preview.id)) return
    savingIdsRef.current = new Set(savingIdsRef.current).add(preview.id)
    setSavingIds(prev => new Set(prev).add(preview.id))
    setSavedIds(prev => new Set(prev).add(preview.id))
    try {
      const savedLead = await runExclusive(
        actionKey('save-lead', company.id, preview.id),
        () => saveLead({
          companyId: company.id,
          contactId: null,
          apolloPersonId: preview.id,
          notes: `Apollo contact: ${preview.firstName} ${preview.lastNameObfuscated} - ${preview.title || 'unknown title'}`,
        }),
      )
      onLeadSaved()
      if (activeCampaign?.id && savedLead?.id) {
        try {
          await addCampaignLead(activeCampaign.id, savedLead.id)
        } catch (campaignErr) {
          const ce = campaignErr as { message?: string }
          showToast({ type: 'error', title: 'Saved, but not added to campaign', message: ce?.message || 'Please try again.' })
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
      if (mountedRef.current) {
        setSavedIds(prev => { const n = new Set(prev); n.delete(preview.id); return n })
      }
      const e = err as { message?: string }
      showToast({ type: 'error', title: 'Could not save prospect', message: e?.message || 'Please try again.' })
    } finally {
      if (mountedRef.current) {
        setSavingIds(prev => {
          const n = new Set(prev)
          n.delete(preview.id)
          savingIdsRef.current = n
          return n
        })
      }
    }
  }, [company.id, activeCampaign, savedIds, persistedSavedApolloIds, showToast, onLeadSaved])

  return (
    <Modal open={true} onClose={onClose} title={`${company.name}: Contacts`} size="lg">
      <div className="px-6 py-4 space-y-4">
        <div className="flex flex-col gap-1">
          {company.oneLiner && <p className="text-sm text-muted">{company.oneLiner}</p>}
          {company.website && (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
            >
              <Globe size={11} />{company.domain}
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
          {!apolloLoading && !apolloError && previews.length === 0 && (
            <EmptyState className="py-6">
              Apollo had no contacts on file for this company. Try another from the list - small startups often aren&apos;t indexed.
            </EmptyState>
          )}
          {!apolloLoading && !apolloError && previews.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">
                {previews.length} contact{previews.length !== 1 ? 's' : ''}
                {usedFallback && (
                  <span className="ml-2 normal-case tracking-normal text-muted/70">
                    · no senior matches, showing all
                  </span>
                )}
              </p>
              {previews.map(p => (
                <PersonRow
                  key={p.id}
                  preview={p}
                  email={cache.revealedEmails[p.id]}
                  onSave={handleSaveLead}
                  saving={savingIds.has(p.id)}
                  saved={savedIds.has(p.id) || persistedSavedApolloIds.has(p.id)}
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
    </Modal>
  )
}
