// @vitest-environment jsdom

import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'

// Mock context hooks the dialog touches. We don't render the real providers
// because the contract under test is the dialog's effects + cache writes,
// not the toast viewport or app-data wiring.
const showToastMock = vi.fn()
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: showToastMock,
    dismissToast: vi.fn(),
    reportError: vi.fn(),
  }),
}))

// API client mocks. Each test sets up apolloSearchMock / revealApolloContactMock
// fresh so deferred-promise scenarios stay isolated.
const apolloSearchMock = vi.fn()
const revealApolloContactMock = vi.fn()
const saveLeadMock = vi.fn()
const addCampaignLeadMock = vi.fn()
vi.mock('../lib/api', () => ({
  apolloSearch: (...args: unknown[]) => apolloSearchMock(...args),
  revealApolloContact: (...args: unknown[]) => revealApolloContactMock(...args),
  saveLead: (...args: unknown[]) => saveLeadMock(...args),
  addCampaignLead: (...args: unknown[]) => addCampaignLeadMock(...args),
}))

vi.mock('../lib/pendingActions', () => ({
  actionKey: (...parts: unknown[]) => parts.join(':'),
  runExclusive: async (_key: string, fn: () => Promise<unknown>) => fn(),
}))

import ApolloDialog from '../components/LeadDiscovery/ApolloDialog'
import { emptyApolloCache, type ApolloCache } from '../components/LeadDiscovery/ApolloDialog/_apolloCache'

const company = {
  id: 'co_1',
  name: 'Acme',
  domain: 'acme.com',
  website: 'https://acme.com',
  oneLiner: 'Builds things.',
}

const preview = (id: string, hasEmail = true) => ({
  id, firstName: 'A', lastNameObfuscated: 'B.', title: 'Eng', hasEmail,
})

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Harness mirrors the parent's responsibility: hold cache in state, pass it
// down, re-render on update. The dialog reads cache via prop, so without a
// real state container the dialog never sees its own writes.
//
// `dialogVisible` lets a test close the dialog while keeping the harness
// (= parent) mounted, matching production where LeadDiscoveryTab stays
// mounted but the dialog unmounts on selectedCompany=null. Without that,
// RTL's unmount() unmounts everything and parent setState no-ops too.
interface HarnessProps {
  initialCache?: ApolloCache
  activeCampaign?: { id: string; name: string } | null
  persistedSavedApolloIds?: Set<string>
  onClose: () => void
  onLeadSaved: () => void
  onCompanyNoLongerAvailable: (id: string) => void
  cacheRef: { current: ApolloCache }
  controllerRef: { current: { closeDialog: () => void } | null }
}

function Harness({
  initialCache,
  activeCampaign = null,
  persistedSavedApolloIds = new Set(),
  onClose, onLeadSaved, onCompanyNoLongerAvailable,
  cacheRef,
  controllerRef,
}: HarnessProps) {
  const [cache, setCache] = useState<ApolloCache>(initialCache ?? emptyApolloCache())
  const [dialogVisible, setDialogVisible] = useState(true)
  cacheRef.current = cache
  controllerRef.current = { closeDialog: () => setDialogVisible(false) }
  if (!dialogVisible) return null
  return (
    <ApolloDialog
      company={company}
      apolloRole={null}
      activeCampaign={activeCampaign}
      persistedSavedApolloIds={persistedSavedApolloIds}
      cache={cache}
      onCacheUpdate={(updater: (prev: ApolloCache) => ApolloCache) => setCache(prev => updater(prev))}
      onClose={onClose}
      onLeadSaved={onLeadSaved}
      onCompanyNoLongerAvailable={onCompanyNoLongerAvailable}
    />
  )
}

describe('ApolloDialog', () => {
  let cacheRef: { current: ApolloCache }
  let controllerRef: { current: { closeDialog: () => void } | null }
  let onClose: ReturnType<typeof vi.fn<() => void>>
  let onLeadSaved: ReturnType<typeof vi.fn<() => void>>
  let onCompanyNoLongerAvailable: ReturnType<typeof vi.fn<(id: string) => void>>

  beforeEach(() => {
    cacheRef = { current: emptyApolloCache() }
    controllerRef = { current: null }
    onClose = vi.fn<() => void>()
    onLeadSaved = vi.fn<() => void>()
    onCompanyNoLongerAvailable = vi.fn<(id: string) => void>()
    apolloSearchMock.mockReset()
    revealApolloContactMock.mockReset()
    saveLeadMock.mockReset()
    addCampaignLeadMock.mockReset()
    showToastMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Wrap in StrictMode so the test exercises React 18+'s double-invoke
  // effects in dev. Production uses StrictMode (src/main.tsx) and we lost a
  // ~3min e2e cycle catching a mountedRef regression that StrictMode-aware
  // tests would have caught in ~50ms.
  const harness = (extras?: Partial<HarnessProps>) => (
    <StrictMode>
      <Harness
        cacheRef={cacheRef}
        controllerRef={controllerRef}
        onClose={onClose}
        onLeadSaved={onLeadSaved}
        onCompanyNoLongerAvailable={onCompanyNoLongerAvailable}
        {...extras}
      />
    </StrictMode>
  )

  const closeDialog = () => act(() => { controllerRef.current?.closeDialog() })

  it('fetches contacts and populates cache on mount', async () => {
    apolloSearchMock.mockResolvedValue({
      previews: [preview('p1', false), preview('p2', false)],
      companyId: 'co_1',
      usedFallback: false,
    })

    const { findByText } = render(harness())
    expect(apolloSearchMock).toHaveBeenCalledWith('acme.com', 'co_1', null)

    await findByText(/2 contacts/i)
    expect(cacheRef.current.previews['co_1']?.previews).toHaveLength(2)
    expect(cacheRef.current.previews['co_1']?.usedFallback).toBe(false)
  })

  it('skips apolloSearch when cache already has previews for this company', async () => {
    const initialCache = emptyApolloCache()
    initialCache.previews['co_1'] = {
      previews: [preview('p1', false)],
      usedFallback: true,
    }

    const { findByText } = render(harness({ initialCache }))
    await findByText(/1 contact/i)
    await findByText(/no senior matches/i)
    expect(apolloSearchMock).not.toHaveBeenCalled()
  })

  it('skips revealing a contact whose personId is already in cache.revealedEmails', async () => {
    const initialCache = emptyApolloCache()
    initialCache.revealedEmails['p1'] = 'already@acme.com'
    apolloSearchMock.mockResolvedValue({
      previews: [preview('p1', true), preview('p2', true)],
      companyId: 'co_1',
      usedFallback: false,
    })
    revealApolloContactMock.mockResolvedValue({ revealed: true, contact: { email: 'p2@acme.com', name: null, title: null, linkedinUrl: null } })

    const { findByText } = render(harness({ initialCache }))
    await findByText(/2 contacts/i)

    await waitFor(() => {
      expect(revealApolloContactMock).toHaveBeenCalledWith('p2', 'co_1', 'acme.com')
    })
    // p1 already had a cached email and must never be re-revealed. StrictMode
    // double-invokes the reveal effect so p2 may show up >1 time — what
    // matters is that the gate keeps p1 out.
    const personIdsRevealed = revealApolloContactMock.mock.calls.map(c => c[0])
    expect(personIdsRevealed).not.toContain('p1')
  })

  it('on 404 from apolloSearch, calls onCompanyNoLongerAvailable + onClose', async () => {
    apolloSearchMock.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }))

    render(harness())

    await waitFor(() => {
      expect(onCompanyNoLongerAvailable).toHaveBeenCalledWith('co_1')
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('seam: search resolving AFTER unmount still writes previews to cache, no warning', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deferred<{ previews: ReturnType<typeof preview>[]; companyId: string; usedFallback: boolean }>()
    // mockReturnValue (not Once) so StrictMode's double-invoked effect also
    // gets the deferred — both calls resolve when we resolve d, and both
    // cache writes are idempotent (same payload).
    apolloSearchMock.mockReturnValue(d.promise)

    render(harness())
    expect(apolloSearchMock).toHaveBeenCalled()

    closeDialog()

    await act(async () => {
      d.resolve({ previews: [preview('p1', false)], companyId: 'co_1', usedFallback: false })
      await Promise.resolve()
    })

    expect(cacheRef.current.previews['co_1']?.previews).toHaveLength(1)

    const reactWarnings = consoleErrorSpy.mock.calls.filter(call =>
      typeof call[0] === 'string' && /unmounted|act\(/i.test(call[0]),
    )
    expect(reactWarnings).toEqual([])
  })

  it('seam: reveal resolving AFTER unmount still writes the email to cache.revealedEmails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    apolloSearchMock.mockResolvedValue({
      previews: [preview('p1', true)],
      companyId: 'co_1',
      usedFallback: false,
    })
    const revealD = deferred<{ revealed: boolean; contact?: { email: string | null; name: null; title: null; linkedinUrl: null } }>()
    revealApolloContactMock.mockReturnValue(revealD.promise)

    const { findByText } = render(harness())
    await findByText(/1 contact/i)
    await waitFor(() => { expect(revealApolloContactMock).toHaveBeenCalled() })

    closeDialog()

    await act(async () => {
      revealD.resolve({ revealed: true, contact: { email: 'p1@acme.com', name: null, title: null, linkedinUrl: null } })
      await Promise.resolve()
    })

    expect(cacheRef.current.revealedEmails['p1']).toBe('p1@acme.com')

    const reactWarnings = consoleErrorSpy.mock.calls.filter(call =>
      typeof call[0] === 'string' && /unmounted|act\(/i.test(call[0]),
    )
    expect(reactWarnings).toEqual([])
  })
})
