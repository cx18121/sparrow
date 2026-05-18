import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus } from 'lucide-react'
import Banner from '../ui/Banner'
import { useToast } from '../../contexts/ToastContext'
import { fetchCampaignOptions, fetchEmailsCombined } from '../../lib/api'
import { useAppData, type UiCampaign } from '../../contexts/AppDataContext'
import { audienceFromCampaign, audienceToDisplayPills } from '../../types/audience'
import CreateCampaignWizard, { submissionToCampaignPayload, type WizardSubmission } from '../Wizard/CreateCampaignWizard'
import { defaultAttachmentIds } from '../../lib/attachments'
import type { CampaignOptions, DashboardSendStats } from '../../types/api'
import SendActivity from './SendActivity'

// Phase 1 stood up the new campaigns-first surface; Phase 2 replaces the
// modal-based campaign creator with the full-screen 4-step wizard. Phase 4e
// retired the Discover / Contacts / Drafts / Campaigns top-level surfaces -
// per-campaign work now lives entirely inside the workspace at
// /campaigns/:id/* and Home navigates straight there via useNavigate().

const EMPTY_OPTIONS: CampaignOptions = {
  industries: [], regions: [], stages: [], batches: [], tags: {}, hiringCount: 0,
}

const STATUS_LABEL: Record<UiCampaign['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
}

function formatRelative(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface KpiCellProps {
  label: string
  value: number | string
  helper?: string
  loading?: boolean
  onClick?: () => void
}

// Divided-strip KPI cell: not a box, no icon ornament. The grid wrapper
// supplies the visual structure (divide-x + bottom hairline); the cell
// is just typographic info. `onClick` makes the cell a button with a
// tinted hover surface and a primary-tinted number on hover.
function KpiCell({ label, value, helper, loading, onClick }: KpiCellProps) {
  const display = loading && (value === 0 || value === '') ? '-' : value
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`group block px-6 py-5 text-left sm:px-10 sm:py-6 ${onClick ? 'transition-colors hover:bg-warm-50/70 active:bg-warm-50 cursor-pointer' : ''}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted/80">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-3xl font-semibold leading-none text-dark tabular-nums transition-colors group-hover:text-primary-700">
          {display}
        </span>
        {helper && <span className="text-xs text-muted">{helper}</span>}
      </div>
    </Tag>
  )
}

interface CampaignRowProps {
  campaign: UiCampaign & { template?: { id: string; name: string } | null }
  templateName: string | null
  onClick: () => void
}

// Status visual: ink color + weight, no dot. The label's typography
// carries the status — saves a glyph, drops a SaaS reflex.
const STATUS_INK: Record<UiCampaign['status'], string> = {
  active: 'text-primary-700 font-semibold',
  paused: 'text-accent-700 font-medium',
  completed: 'text-warm-500 font-medium',
}

function CampaignRow({ campaign, templateName, onClick }: CampaignRowProps) {
  const audience = audienceToDisplayPills(audienceFromCampaign(campaign)).slice(0, 3).join(' · ')
  const status = campaign.status
  const leads = campaign.leadCount ?? 0
  const drafts = campaign.draftCount ?? 0
  const sent = campaign.sentCount ?? 0
  // Optimistic temp-id rows are pre-server commit. Clicking through would
  // 404 every workspace fetch, so render them disabled until the real id
  // arrives.
  const isOptimistic = campaign.id.startsWith('temp-')
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={isOptimistic}
        aria-busy={isOptimistic || undefined}
        className={`group grid w-full grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 px-6 py-4 text-left transition-colors sm:grid-cols-[1fr_minmax(0,7rem)_minmax(0,11rem)_minmax(0,5rem)] sm:items-baseline sm:gap-x-8 sm:px-10 ${
          isOptimistic ? 'cursor-progress opacity-60' : 'hover:bg-warm-50/70'
        }`}
      >
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-dark transition-colors group-hover:text-primary-700">{campaign.name}</p>
          {audience && <p className="mt-0.5 truncate text-xs text-muted">{audience}</p>}
        </div>
        <span className={`text-xs uppercase tracking-[0.14em] sm:justify-self-start ${STATUS_INK[status]}`}>
          {STATUS_LABEL[status]}
        </span>
        <span className="hidden text-xs tabular-nums text-muted sm:block sm:text-right">
          {leads} {leads === 1 ? 'lead' : 'leads'}
          {' · '}
          {drafts > 0
            ? <span className="font-medium text-primary-700">{drafts} {drafts === 1 ? 'draft' : 'drafts'}</span>
            : <>{drafts} drafts</>}
          {' · '}
          {sent} sent
        </span>
        <span className="hidden text-right text-xs tabular-nums text-muted sm:block">
          {isOptimistic ? 'Saving…' : formatRelative(campaign.updatedAt)}
        </span>
      </button>
    </li>
  )
}

function WelcomeBlock({ name, onCreate }: { name: string; onCreate: () => void }) {
  return (
    <div className="px-6 py-16 sm:px-10 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="page-eyebrow">Home</p>
        <h1 className="mt-3 font-display text-3xl font-semibold leading-tight text-dark sm:text-4xl">
          {name ? `Welcome, ${name}.` : 'Welcome to Sparrow.'}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted">
          Create a campaign to find leads, draft emails, and track what gets sent.
        </p>

        <button onClick={onCreate} className="btn-primary mt-7">
          <Plus size={14} /> Create your first campaign
        </button>
      </div>
    </div>
  )
}

interface HomePageProps {
  workspaceConfig: any
}

export default function HomePage({ workspaceConfig }: HomePageProps) {
  const navigate = useNavigate()
  // Optimistic temp-id rows aren't persisted server-side yet - clicking
  // through would 404 every workspace fetch. The card itself is rendered as
  // disabled in this case; this guard is defense in depth.
  const enterCampaign = useCallback((campaign: { id: string; name: string }) => {
    if (campaign.id.startsWith('temp-')) return
    navigate(`/campaigns/${campaign.id}/overview`)
  }, [navigate])
  const {
    campaigns, leads, customContacts, templates,
    dataLoaded, hasResourceCache,
    createCampaign,
  } = useAppData()
  const dataLoading = !dataLoaded && !hasResourceCache

  const [drafts, setDrafts] = useState<any[]>([])
  const [sent, setSent] = useState<any[]>([])
  // Server-side aggregate send counts. The `sent` array is capped at 20
  // by readDashboardEmailQueue, so any window count derived from it would
  // silently cap at 20 — these come from server COUNTs instead.
  const [stats, setStats] = useState<DashboardSendStats | null>(null)
  const [emailsLoading, setEmailsLoading] = useState(true)
  const [emailsError, setEmailsError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [options, setOptions] = useState<CampaignOptions>(EMPTY_OPTIONS)
  const { showToast } = useToast()

  // Sidebar's "+" next to Campaigns navigates to /dashboard?new=1 to open
  // the wizard from anywhere. Honour that param once and strip it from the
  // URL so a refresh doesn't re-fire.
  const location = useLocation()
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('new') !== '1') return
    setWizardOpen(true)
    params.delete('new')
    const next = `${location.pathname}${params.toString() ? `?${params}` : ''}`
    window.history.replaceState(null, '', next)
  }, [location.search, location.pathname])

  useEffect(() => {
    let cancelled = false
    fetchEmailsCombined()
      .then(res => {
        if (cancelled) return
        setDrafts(res?.drafts || [])
        setSent(res?.sent || [])
        setStats(res?.stats || null)
        setEmailsLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setEmailsError(err?.message || 'Could not load emails')
        setEmailsLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // Lazy-load campaign options the first time the wizard opens - they're only
  // needed for filter pill rendering in Step 2 and don't justify the cost on
  // every Home render.
  useEffect(() => {
    if (!wizardOpen) return
    let cancelled = false
    fetchCampaignOptions()
      .then(res => { if (!cancelled) setOptions(res) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [wizardOpen])

  // `sent` is capped at 20 by the dashboard query, so the previous
  // client-side filter silently capped this number too. The server-side
  // sentLast7Days count is the truthful version.
  const sentThisWeek = stats?.sentLast7Days ?? 0

  const totalLeadPool = leads.length + customContacts.length
  const activeCount = campaigns.filter(c => c.status === 'active').length
  const firstName = workspaceConfig?.senderName?.trim().split(' ')[0] || ''

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  const greetingStat = useMemo(() => {
    const parts: string[] = []
    if (drafts.length) parts.push(`${drafts.length} draft${drafts.length === 1 ? '' : 's'} waiting`)
    if (sentThisWeek) parts.push(`${sentThisWeek} sent this week`)
    if (activeCount) parts.push(`${activeCount} campaign${activeCount === 1 ? '' : 's'} running`)
    return parts.join(' · ')
  }, [drafts.length, sentThisWeek, activeCount])

  const sortedCampaigns = useMemo(() => {
    return [...campaigns].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [campaigns])

  // Most recently updated active campaign — used as the KPI card navigation target.
  const mostRecentActiveCampaign = useMemo(
    () => sortedCampaigns.find(c => c.status === 'active') ?? sortedCampaigns[0] ?? null,
    [sortedCampaigns]
  )
  const goToCampaignTab = (tab: string) => {
    if (!mostRecentActiveCampaign || mostRecentActiveCampaign.id.startsWith('temp-')) return
    navigate(`/campaigns/${mostRecentActiveCampaign.id}/${tab}`)
  }

  const openCreate = () => setWizardOpen(true)

  const handleWizardSubmit = async (submission: WizardSubmission) => {
    setSaving(true)
    try {
      const payload = submissionToCampaignPayload(submission)
      // Honor the workspace default template when the wizard left it unset.
      if (!payload.templateId && workspaceConfig?.templateId) {
        payload.templateId = workspaceConfig.templateId
      }
      const selectedTemplate = templates.find(t => t.id === payload.templateId) || null
      payload.attachmentIds = defaultAttachmentIds(workspaceConfig, selectedTemplate)
      const created = await createCampaign(payload)
      setWizardOpen(false)
      enterCampaign({ id: created.id, name: created.name })
      return created
    } catch (err: any) {
      showToast({ type: 'error', title: 'Could not create campaign', message: err?.message || 'Try again.' })
      throw err
    } finally {
      setSaving(false)
    }
  }

  // Still loading from network with no local cache — return null to avoid
  // flashing an empty full-page layout then switching to the welcome block.
  if (dataLoading) return null

  // Empty state: no campaigns, no stats - workspace shows just the welcome.
  if (campaigns.length === 0) {
    return (
      <div className="page-shell">
        <div className="workspace">
          <WelcomeBlock name={firstName} onCreate={openCreate} />
        </div>
        <CreateCampaignWizard
          open={wizardOpen}
          templates={templates}
          options={options}
          saving={saving}
          defaultTargetRole={workspaceConfig?.targetRole ?? null}
          onCancel={() => setWizardOpen(false)}
          onSubmit={handleWizardSubmit}
        />
      </div>
    )
  }

  return (
    <div className="page-shell">
      <div className="workspace">
        {/* Header band */}
        <header className="border-b border-warm-200 px-6 pb-6 pt-8 sm:px-10 sm:pt-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="page-eyebrow">Home</p>
              <h1 className="mt-3 font-display text-[2rem] font-semibold leading-tight text-dark">
                {firstName ? `${greeting}, ${firstName}.` : 'Welcome back.'}
              </h1>
              {greetingStat && (
                <p className="mt-2 text-sm leading-6 text-muted">{greetingStat}</p>
              )}
            </div>
            <button onClick={openCreate} className="btn-primary self-start sm:self-auto">
              <Plus size={14} /> New campaign
            </button>
          </div>
        </header>

        {emailsError && (
          <div className="border-b border-warm-200 px-6 py-4 sm:px-10">
            <Banner variant="warning">{emailsError}</Banner>
          </div>
        )}

        {/* KPI divided strip. Send-related counts live in the SendActivity
            section below to avoid duplicating "X this week" in two places. */}
        <div className="grid grid-cols-2 divide-x divide-warm-200 border-b border-warm-200">
          <KpiCell
            label="Lead Pool"
            value={totalLeadPool}
            helper="across all campaigns"
            loading={dataLoading}
            onClick={mostRecentActiveCampaign ? () => goToCampaignTab('leads') : undefined}
          />
          <KpiCell
            label="Drafts"
            value={drafts.length}
            helper="waiting review"
            loading={emailsLoading}
            onClick={mostRecentActiveCampaign ? () => goToCampaignTab('drafts') : undefined}
          />
        </div>

        {/* Campaign list. Rows on white, hairline separators. */}
        <section className="px-6 pt-8 sm:px-10">
          <div className="flex items-baseline justify-between border-b border-warm-200 pb-3">
            <h2 className="font-display text-lg font-semibold text-dark">Campaigns</h2>
            <span className="text-xs tabular-nums text-muted">
              {campaigns.length} {campaigns.length === 1 ? 'campaign' : 'campaigns'}
            </span>
          </div>
          <ol className="-mx-6 divide-y divide-warm-200 sm:-mx-10">
            {sortedCampaigns.map(campaign => {
              const tpl = templates.find(t => t.id === campaign.templateId)
              return (
                <CampaignRow
                  key={campaign.id}
                  campaign={campaign}
                  templateName={tpl?.name ?? null}
                  onClick={() => enterCampaign({ id: campaign.id, name: campaign.name })}
                />
              )
            })}
          </ol>
        </section>

        <SendActivity
          stats={stats}
          loading={emailsLoading || stats == null}
          dailyMax={workspaceConfig?.sendingLimits?.dailyMax ?? 250}
          monthlyMax={workspaceConfig?.sendingLimits?.monthlyMax ?? 2000}
        />
      </div>

      <CreateCampaignWizard
        open={wizardOpen}
        templates={templates}
        options={options}
        saving={saving}
        defaultTargetRole={workspaceConfig?.targetRole ?? null}
        onCancel={() => setWizardOpen(false)}
        onSubmit={handleWizardSubmit}
      />
    </div>
  )
}
