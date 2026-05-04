import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowRight, FileText, Plus, Send, Users,
} from 'lucide-react'
import Banner from '../ui/Banner'
import Pill from '../ui/Pill'
import Toast from '../ui/Toast'
import { fetchCampaignOptions, fetchEmailsCombined } from '../../lib/api'
import { useAppData, type UiCampaign } from '../../contexts/AppDataContext'
import { audienceFromCampaign, audienceToDisplayPills } from '../../types/audience'
import CreateCampaignWizard, { submissionToCampaignPayload, type WizardSubmission } from '../Wizard/CreateCampaignWizard'
import type { CampaignOptions } from '../../types/api'

// Phase 1 stood up the new campaigns-first surface; Phase 2 replaces the
// modal-based campaign creator with the full-screen 4-step wizard. Phase 4e
// retired the Discover / Contacts / Drafts / Campaigns top-level surfaces —
// per-campaign work now lives entirely inside the workspace at
// /campaigns/:id/* and Home navigates straight there via useNavigate().

const EMPTY_OPTIONS: CampaignOptions = {
  industries: [], regions: [], stages: [], batches: [], tags: {}, hiringCount: 0,
}

const STATUS_VARIANT: Record<UiCampaign['status'], 'success' | 'warning' | 'info'> = {
  active: 'success',
  paused: 'warning',
  completed: 'info',
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

interface KpiCardProps {
  label: string
  value: number | string
  helper?: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  loading?: boolean
}

function KpiCard({ label, value, helper, icon: Icon, loading }: KpiCardProps) {
  const display = loading && (value === 0 || value === '') ? '—' : value
  return (
    <div className="rounded-2xl border border-warm-200 bg-panel px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">{label}</p>
        <Icon size={14} className="text-muted/60" />
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-[2rem] font-semibold leading-none tracking-[-0.03em] text-dark tabular-nums">
          {display}
        </span>
        {helper && <span className="text-xs text-muted">{helper}</span>}
      </div>
    </div>
  )
}

interface CampaignCardProps {
  campaign: UiCampaign & { template?: { id: string; name: string } | null }
  templateName: string | null
  onClick: () => void
}

function CampaignCard({ campaign, templateName, onClick }: CampaignCardProps) {
  const audience = audienceToDisplayPills(audienceFromCampaign(campaign)).slice(0, 3).join(' · ')
  const status = campaign.status
  // Optimistic temp-id rows are pre-server commit. Letting them be clicked
  // navigates to a workspace URL the server doesn't know about, and every
  // fetch the workspace makes 404s. Render them muted + non-clickable until
  // the real id arrives (typically a sub-second swap).
  const isOptimistic = campaign.id.startsWith('temp-')
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isOptimistic}
      aria-busy={isOptimistic || undefined}
      className={`group flex w-full flex-col gap-3 rounded-2xl border border-warm-200 bg-panel px-5 py-4 text-left transition-all duration-150 ${
        isOptimistic
          ? 'cursor-progress opacity-60'
          : 'hover:-translate-y-0.5 hover:border-primary/30 hover:bg-warm-50 active:translate-y-0'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <Pill variant={STATUS_VARIANT[status]} dot>{STATUS_LABEL[status]}</Pill>
        <ArrowRight size={14} className="text-muted/40 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-primary/60" />
      </div>
      <div>
        <h3 className="font-display text-base font-semibold tracking-[-0.01em] text-dark">{campaign.name}</h3>
        {audience && <p className="mt-1 line-clamp-1 text-xs text-muted">{audience}</p>}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-warm-200/70 pt-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted/70">Batch</div>
        <div className="text-right text-sm font-medium tabular-nums text-dark">{campaign.currentBatch ?? 0}</div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted/70">Size</div>
        <div className="text-right text-sm font-medium tabular-nums text-dark">{campaign.batchSize ?? 10}</div>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>{isOptimistic ? 'Saving…' : formatRelative(campaign.updatedAt)}</span>
        {templateName && <span className="truncate">{templateName}</span>}
      </div>
    </button>
  )
}

function NewCampaignCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-warm-300 bg-warm-50/40 px-5 py-6 text-muted transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-warm-50 hover:text-dark active:translate-y-0"
    >
      <Plus size={18} />
      <span className="font-display text-base font-semibold text-dark">New campaign</span>
      <span className="text-xs">Define a search, save leads, send drafts</span>
    </button>
  )
}

function WelcomeCard({ name, onCreate }: { name: string; onCreate: () => void }) {
  return (
    <div className="mx-auto mt-20 flex max-w-xl flex-col items-start text-left sm:mt-28">
      {/* Quiet display-font anchor at low opacity so the eye has a focal
          point without resorting to an icon chip in a rounded square. */}
      <span
        aria-hidden
        className="font-display text-[7rem] font-semibold leading-none tracking-[-0.06em] text-primary/10 sm:text-[9rem]"
      >
        s
      </span>

      <h1 className="-mt-3 font-display text-[clamp(2.25rem,4.5vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-dark">
        {name ? `Welcome, ${name}.` : 'Welcome to Sparrow.'}
      </h1>
      <p className="mt-3 text-base leading-7 text-muted">
        Each campaign carries its own audience, template, and lead pool.
      </p>

      <button onClick={onCreate} className="btn-primary mt-7">
        <Plus size={14} /> Create your first campaign
      </button>
    </div>
  )
}

interface HomePageProps {
  workspaceConfig: { senderName?: string; templateId?: string | null }
}

export default function HomePage({ workspaceConfig }: HomePageProps) {
  const navigate = useNavigate()
  // Optimistic temp-id rows aren't persisted server-side yet — clicking
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
  const [emailsLoading, setEmailsLoading] = useState(true)
  const [emailsError, setEmailsError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [options, setOptions] = useState<CampaignOptions>(EMPTY_OPTIONS)
  const [toast, setToast] = useState<{ type: string; title: string; message?: string } | null>(null)

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
        setEmailsLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setEmailsError(err?.message || 'Could not load emails')
        setEmailsLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // Lazy-load campaign options the first time the wizard opens — they're only
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

  const sentThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    return sent.filter(e => {
      const d = new Date(e.sentAt || e.updatedAt || '')
      return !isNaN(d.getTime()) && d.getTime() >= weekAgo
    }).length
  }, [sent])

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

  const openCreate = () => setWizardOpen(true)

  const handleWizardSubmit = async (submission: WizardSubmission) => {
    setSaving(true)
    try {
      const payload = submissionToCampaignPayload(submission)
      // Honor the workspace default template when the wizard left it unset.
      if (!payload.templateId && workspaceConfig?.templateId) {
        payload.templateId = workspaceConfig.templateId
      }
      const created = await createCampaign(payload)
      setWizardOpen(false)
      enterCampaign({ id: created.id, name: created.name })
      return created
    } catch (err: any) {
      setToast({ type: 'error', title: 'Could not create campaign', message: err?.message || 'Try again.' })
      throw err
    } finally {
      setSaving(false)
    }
  }

  // Empty state: no campaigns, no stats — just one welcome card.
  if (dataLoaded && campaigns.length === 0) {
    return (
      <div className="page-shell">
        <Toast toast={toast} onClose={() => setToast(null)} />
        <WelcomeCard name={firstName} onCreate={openCreate} />
        <CreateCampaignWizard
          open={wizardOpen}
          templates={templates}
          options={options}
          saving={saving}
          onCancel={() => setWizardOpen(false)}
          onSubmit={handleWizardSubmit}
        />
      </div>
    )
  }

  return (
    <div className="page-shell">
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Greeting strip */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-eyebrow">Home</p>
          <h1 className="mt-2 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-dark">
            {firstName ? `${greeting}, ${firstName}.` : 'Welcome back.'}
          </h1>
          {greetingStat && (
            <p className="mt-2 text-sm leading-relaxed text-muted">{greetingStat}</p>
          )}
        </div>
        <button onClick={openCreate} className="btn-primary self-start lg:self-auto">
          <Plus size={14} /> New campaign
        </button>
      </section>

      {emailsError && (
        <Banner variant="warning">{emailsError}</Banner>
      )}

      {/* KPI cards — Lead Pool / Drafts / Sent This Week */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Lead Pool"
          value={totalLeadPool}
          helper={totalLeadPool === 1 ? 'across all campaigns' : 'across all campaigns'}
          icon={Users}
          loading={dataLoading}
        />
        <KpiCard
          label="Drafts"
          value={drafts.length}
          helper={drafts.length === 1 ? 'waiting review' : 'waiting review'}
          icon={FileText}
          loading={emailsLoading}
        />
        <KpiCard
          label="Sent this week"
          value={sentThisWeek}
          helper={sentThisWeek === 1 ? 'across all campaigns' : 'across all campaigns'}
          icon={Send}
          loading={emailsLoading}
        />
      </section>

      {/* Campaign grid */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Campaigns</h2>
          <span className="text-xs tabular-nums text-muted">
            {campaigns.length} {campaigns.length === 1 ? 'campaign' : 'campaigns'}
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sortedCampaigns.map(campaign => {
            const tpl = templates.find(t => t.id === campaign.templateId)
            return (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                templateName={tpl?.name ?? null}
                onClick={() => enterCampaign({ id: campaign.id, name: campaign.name })}
              />
            )
          })}
          <NewCampaignCard onClick={openCreate} />
        </div>
      </section>

      <CreateCampaignWizard
        open={wizardOpen}
        templates={templates}
        options={options}
        saving={saving}
        onCancel={() => setWizardOpen(false)}
        onSubmit={handleWizardSubmit}
      />
    </div>
  )
}
