import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { ArrowRight, KeyRound, Loader2, Mail, PenLine, Send, Users } from 'lucide-react'
import Banner from '../ui/Banner'
import Pill from '../ui/Pill'
import LeadDiscoveryTab from '../LeadDiscovery/LeadDiscoveryTab'
import DraftsTab from '../Drafts/DraftsTab'
import SettingsTabImpl from './SettingsTab'
import { audienceFromCampaign, audienceToDisplayPills } from '../../types/audience'
import { fetchCampaignLeads, fetchEmailsCombined } from '../../lib/api'
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
  const navigate = useNavigate()
  const audiencePills = audienceToDisplayPills(audienceFromCampaign(campaign))
  const [counts, setCounts] = useState<{ leads: number; drafts: number; sent: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setCounts(null)
    setError(null)
    Promise.all([
      fetchCampaignLeads(campaign.id),
      fetchEmailsCombined({ campaignId: campaign.id }),
    ])
      .then(([leadsRes, emailsRes]) => {
        if (cancelled) return
        setCounts({
          leads: leadsRes?.items?.length ?? 0,
          drafts: emailsRes?.drafts?.length ?? 0,
          sent: emailsRes?.sent?.length ?? 0,
        })
      })
      .catch(err => {
        if (cancelled) return
        setError(err?.message || 'Could not load campaign activity.')
      })
    return () => { cancelled = true }
  }, [campaign.id])

  const next = nextAction(counts, campaign.status)

  return (
    <div className="space-y-5">
      <NextActionHero
        loading={!counts && !error}
        next={next}
        campaignId={campaign.id}
        onJump={(tab) => navigate(`/campaigns/${campaign.id}/${tab}`)}
      />

      <StatsStrip
        loading={!counts && !error}
        counts={counts}
        onJump={(tab) => navigate(`/campaigns/${campaign.id}/${tab}`)}
      />

      <div className="rounded-2xl border border-warm-200 bg-panel px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Audience</p>
        {audiencePills.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {audiencePills.map(p => (
              <Pill key={p} variant="info">{p}</Pill>
            ))}
            <button
              type="button"
              onClick={() => navigate(`/campaigns/${campaign.id}/settings`)}
              className="ml-1 text-[11px] font-medium text-muted hover:text-dark"
            >
              Edit →
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            No filters set. Sparrow samples broadly across your verified company list.
          </p>
        )}
      </div>

      {error && (
        <Banner variant="warning" size="sm">
          {error}
        </Banner>
      )}
    </div>
  )
}

type NextActionState = {
  headline: string
  helper: string
  ctaLabel: string
  ctaTab: 'leads' | 'drafts' | 'sent'
  icon: React.ComponentType<{ size?: number; className?: string }>
}

function nextAction(counts: { leads: number; drafts: number; sent: number } | null, status: string): NextActionState | null {
  if (!counts) return null
  if (status === 'completed') {
    return {
      headline: 'This campaign is complete.',
      helper: 'Read-only. Re-open from Settings if you want to keep generating.',
      ctaLabel: 'View sent',
      ctaTab: 'sent',
      icon: Mail,
    }
  }
  if (counts.leads === 0) {
    return {
      headline: 'Find leads to start.',
      helper: 'Browse companies that match this campaign\'s audience and save the ones worth reaching.',
      ctaLabel: 'Find leads',
      ctaTab: 'leads',
      icon: Users,
    }
  }
  if (counts.drafts === 0 && counts.sent === 0) {
    return {
      headline: `${counts.leads} ${counts.leads === 1 ? 'lead' : 'leads'} saved. Generate drafts.`,
      helper: 'Sparrow drafts personalized emails from your template and each lead\'s company context.',
      ctaLabel: 'Go to Drafts',
      ctaTab: 'drafts',
      icon: PenLine,
    }
  }
  if (counts.drafts > 0) {
    return {
      headline: `${counts.drafts} ${counts.drafts === 1 ? 'draft' : 'drafts'} ready to review.`,
      helper: 'Edit, then send when each one reads right. Sent emails appear in Sent.',
      ctaLabel: 'Review drafts',
      ctaTab: 'drafts',
      icon: PenLine,
    }
  }
  return {
    headline: `${counts.sent} ${counts.sent === 1 ? 'email' : 'emails'} sent.`,
    helper: 'Save more leads to keep the campaign moving.',
    ctaLabel: 'Find more leads',
    ctaTab: 'leads',
    icon: Send,
  }
}

function NextActionHero({
  loading, next, onJump,
}: {
  loading: boolean
  next: NextActionState | null
  campaignId: string
  onJump: (tab: NextActionState['ctaTab']) => void
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-warm-200 bg-panel px-6 py-7">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Loading campaign activity…
        </div>
      </div>
    )
  }
  if (!next) return null
  const Icon = next.icon
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-warm-200 bg-panel px-6 py-7 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-dark sm:text-xl">
            {next.headline}
          </h2>
          <p className="mt-1 max-w-prose text-sm leading-6 text-muted">{next.helper}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onJump(next.ctaTab)}
        className="btn-primary shrink-0 self-start sm:self-auto"
      >
        {next.ctaLabel} <ArrowRight size={14} />
      </button>
    </div>
  )
}

function StatsStrip({
  loading, counts, onJump,
}: {
  loading: boolean
  counts: { leads: number; drafts: number; sent: number } | null
  onJump: (tab: 'leads' | 'drafts' | 'sent') => void
}) {
  const items: { key: 'leads' | 'drafts' | 'sent'; label: string; value: number | null }[] = [
    { key: 'leads',  label: 'Leads',  value: counts?.leads ?? null },
    { key: 'drafts', label: 'Drafts', value: counts?.drafts ?? null },
    { key: 'sent',   label: 'Sent',   value: counts?.sent ?? null },
  ]
  return (
    <div className="flex divide-x divide-warm-200/80 overflow-hidden rounded-2xl border border-warm-200 bg-panel">
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          onClick={() => onJump(item.key)}
          disabled={loading}
          className="group flex flex-1 items-baseline justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-warm-50 disabled:opacity-50"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">
            {item.label}
          </span>
          <span className="font-display text-2xl font-semibold tabular-nums text-dark">
            {item.value === null ? '—' : item.value}
          </span>
        </button>
      ))}
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
  const { campaign, workspaceConfig, profile, profileLoading } = useWorkspaceContext()
  const navigate = useNavigate()
  // Phase 4b: mount the existing Drafts queue scoped to this campaign.
  // `lockedTab='draft'` hides the Drafts/Sent segmented control inside the
  // component — the workspace already has Drafts and Sent as separate URLs,
  // so the inner toggle would be redundant. The Sent sub-tab gets its own
  // mount (still a placeholder until 4c).
  return (
    <div className="space-y-4">
      <ClaudeKeyMissingBanner profile={profile} profileLoading={profileLoading} />
      <DraftsTab
        campaignId={campaign.id}
        lockedTab="draft"
        workspaceConfig={workspaceConfig}
        profile={profile}
        profileLoading={profileLoading}
        onNavigate={(target) => {
          // Empty-state CTAs jump to the matching workspace sub-tab.
          if (target === 'settings') navigate(`/campaigns/${campaign.id}/settings`)
          else if (target === 'contacts' || target === 'leads') navigate(`/campaigns/${campaign.id}/leads`)
          else if (target === 'drafts') navigate(`/campaigns/${campaign.id}/drafts`)
        }}
      />
    </div>
  )
}

// Bug 09: generation requires a Claude key stored on the user's profile.
// The legacy failure mode was a 400 toast surfaced after the user clicked
// Generate; the redesign surfaces the missing-key state up front so the
// user knows there's no point trying. Stays BYO — no env fallback.
function ClaudeKeyMissingBanner({ profile, profileLoading }: { profile: any; profileLoading: boolean }) {
  if (profileLoading || profile?.hasClaudeKey) return null
  return (
    <Banner variant="warning" icon={KeyRound}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span>Add your Claude API key to generate emails — without it, drafts can't be created from this campaign.</span>
        <Link to="/settings" className="shrink-0 font-semibold underline-offset-2 hover:underline">
          Open Settings →
        </Link>
      </div>
    </Banner>
  )
}

export function SentTab() {
  const { campaign, workspaceConfig, profile, profileLoading } = useWorkspaceContext()
  const navigate = useNavigate()
  // Phase 4c: same DraftsTab component, locked to the sent list. The component
  // gates Send/Edit/Delete/attachment controls on `tab === 'draft'` already, so
  // the sent rows are read-only by construction.
  return (
    <DraftsTab
      campaignId={campaign.id}
      lockedTab="sent"
      workspaceConfig={workspaceConfig}
      profile={profile}
      profileLoading={profileLoading}
      onNavigate={(target) => {
        if (target === 'settings') navigate(`/campaigns/${campaign.id}/settings`)
        else if (target === 'contacts' || target === 'leads') navigate(`/campaigns/${campaign.id}/leads`)
        else if (target === 'drafts') navigate(`/campaigns/${campaign.id}/drafts`)
      }}
    />
  )
}

export { SettingsTabImpl as SettingsTab }
