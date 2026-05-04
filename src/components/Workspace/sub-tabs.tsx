import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { CalendarClock, FileText, Inbox, Send, Settings as SettingsIcon } from 'lucide-react'
import Pill from '../ui/Pill'
import LeadDiscoveryTab from '../LeadDiscovery/LeadDiscoveryTab'
import { audienceFromCampaign, audienceToDisplayPills } from '../../types/audience'
import type { UiCampaign } from '../../contexts/AppDataContext'
import type { WorkspaceOutletContext } from './WorkspaceShell'

// Workspace sub-tabs. Overview reads campaign metadata directly. Phase 4
// migrations: Leads now mounts the existing LeadDiscoveryTab scoped to this
// campaign; Drafts / Sent / Settings remain placeholders until 4b–4d.

function useWorkspaceCampaign(): UiCampaign {
  return useOutletContext<WorkspaceOutletContext>().campaign
}

function useWorkspaceContext(): WorkspaceOutletContext {
  return useOutletContext<WorkspaceOutletContext>()
}

export function OverviewTab() {
  const campaign = useWorkspaceCampaign()
  const audiencePills = audienceToDisplayPills(audienceFromCampaign(campaign))
  const updated = formatRelative(campaign.updatedAt)

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <SummaryCard label="Status" icon={CalendarClock}>
        <p className="font-display text-xl font-semibold capitalize text-dark">{campaign.status}</p>
        <p className="mt-1 text-xs text-muted">Updated {updated}</p>
      </SummaryCard>
      <SummaryCard label="Batch" icon={Send}>
        <p className="font-display text-xl font-semibold text-dark tabular-nums">
          {campaign.currentBatch ?? 0}
        </p>
        <p className="mt-1 text-xs text-muted">{campaign.batchSize ?? 10} per pull</p>
      </SummaryCard>
      <SummaryCard label="Template" icon={FileText}>
        <p className="font-display text-base font-semibold text-dark line-clamp-1">
          {campaign.template?.name || 'Write from scratch'}
        </p>
        <p className="mt-1 text-xs text-muted">
          {campaign.includePreviouslySaved
            ? 'Including past-campaign leads'
            : 'Skipping past-campaign leads'}
        </p>
      </SummaryCard>

      <div className="rounded-2xl border border-warm-200 bg-panel px-5 py-4 lg:col-span-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Audience</p>
        {audiencePills.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {audiencePills.map(p => (
              <Pill key={p} variant="info">{p}</Pill>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            No filters set — Sparrow will sample broadly across your verified company list.
          </p>
        )}
      </div>

      <ComingSoonCard
        className="lg:col-span-3"
        title="Live batch progress, reply tracking, and quick actions land here next."
      />
    </div>
  )
}

export function LeadsTab() {
  const { campaign, workspaceConfig } = useWorkspaceContext()
  // Phase 4a: mount the existing Discover surface in-place. The campaign
  // doubles as activeCampaign (so saved leads land in this campaign) and
  // as campaignFilters (it carries all filter* fields directly). Navigation
  // props are intentionally undefined — the workspace header owns navigation
  // now, so the toast actions and the "exit campaign" X are dropped.
  return (
    <LeadDiscoveryTab
      workspaceConfig={workspaceConfig}
      activeCampaign={{ id: campaign.id, name: campaign.name }}
      campaignFilters={campaign}
    />
  )
}

export function DraftsSubTab() {
  return (
    <ComingSoonCard
      icon={Inbox}
      title="Drafts — generated emails waiting on your review"
      body="The Drafts queue moves in here next, scoped to just this campaign's leads. Bulk-generate is being wired through useDraftFlow at the same time."
    />
  )
}

export function SentTab() {
  return (
    <ComingSoonCard
      icon={Send}
      title="Sent — what's already gone out"
      body="A per-campaign send log with subject + recipient + time, filtered to this campaign only."
    />
  )
}

export function SettingsTab() {
  return (
    <ComingSoonCard
      icon={SettingsIcon}
      title="Settings — edit the campaign"
      body="Filters, template, batch size, dedup toggle, attachments — all editable inline here. Moves over from the legacy modal next phase."
    />
  )
}

// ---------- shared ----------

function SummaryCard({
  label, icon: Icon, children,
}: {
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-warm-200 bg-panel px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">{label}</p>
        <Icon size={14} className="text-muted/60" />
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function ComingSoonCard({
  icon: Icon, title, body, className = '',
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>
  title: string
  body?: string
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-dashed border-warm-300 bg-warm-50/40 px-6 py-8 text-center ${className}`}>
      {Icon && (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8 text-primary">
          <Icon size={18} />
        </div>
      )}
      <p className="font-display text-base font-semibold text-dark">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{body}</p>}
    </div>
  )
}

function formatRelative(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
