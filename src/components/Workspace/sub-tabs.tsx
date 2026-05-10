import React from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { ArrowRight, KeyRound, Loader2, Mail, PenLine, Send, Users, MessageSquare } from 'lucide-react'
import Banner from '../ui/Banner'
import Pill from '../ui/Pill'
import LeadDiscoveryTab from '../LeadDiscovery/LeadDiscoveryTab'
import DraftsTab from '../Drafts/DraftsTab'
import ContactsTab from '../Contacts/ContactsTab'
import SettingsTabImpl from './SettingsTab'
import { audienceFromCampaign, audienceToDisplayPills } from '../../types/audience'
import { useCampaignEmails, useCampaignMembers } from '../../hooks/useCampaignWorkspaceData'
import type { UiCampaign } from '../../contexts/AppDataContext'
import type { WorkspaceOutletContext } from './WorkspaceShell'

// Workspace sub-tabs. Overview reads campaign metadata directly. Phase 4
// migrations: Leads now mounts the existing LeadDiscoveryTab scoped to this
// campaign; Drafts / Sent / Settings remain placeholders until 4b-4d.

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
  const members = useCampaignMembers(campaign.id)
  const emails = useCampaignEmails(campaign.id)
  const hasCounts = Boolean(members.data || emails.data)
  const repliesCount = emails.data?.sent?.filter((e: any) => e.repliedAt && e.replyClassification === 'REPLY').length ?? 0
  const counts = hasCounts
    ? {
        leads: members.data?.items?.length ?? 0,
        drafts: emails.data?.drafts?.length ?? 0,
        sent: emails.data?.sent?.length ?? 0,
        replies: repliesCount,
      }
    : null
  const error = members.error || emails.error

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

      <div className="surface-panel px-5 py-4">
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
          {error?.message || 'Could not load campaign activity.'}
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

function nextAction(counts: { leads: number; drafts: number; sent: number; replies: number } | null, status: string): NextActionState | null {
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
      helper: 'Generate drafts from your saved leads and selected template.',
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
      <div className="surface-panel px-6 py-7">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Loading campaign activity…
        </div>
      </div>
    )
  }
  if (!next) return null
  const Icon = next.icon
  return (
    <div className="surface-panel flex flex-col gap-4 px-6 py-7 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-dark sm:text-xl">
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
  counts: { leads: number; drafts: number; sent: number; replies: number } | null
  onJump: (tab: 'leads' | 'drafts' | 'sent') => void
}) {
  const showReplies = counts !== null && (counts.sent > 0 || counts.replies > 0)
  const items: { key: 'leads' | 'drafts' | 'sent'; label: string; value: number | null; helper: string }[] = [
    { key: 'leads', label: 'Leads', value: counts?.leads ?? null, helper: 'Saved contacts' },
    { key: 'drafts', label: 'Drafts', value: counts?.drafts ?? null, helper: 'Ready to review' },
    { key: 'sent', label: 'Sent', value: counts?.sent ?? null, helper: 'Delivered emails' },
    ...(showReplies ? [{ key: 'sent' as const, label: 'Replies', value: counts?.replies ?? null, helper: 'Human responses' }] : []),
  ]
  const cols = showReplies ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
  return (
    <div className="surface-panel overflow-hidden">
      <div className={`grid divide-y divide-warm-200/80 ${cols} sm:divide-x sm:divide-y-0`}>
        {items.map((item, i) => (
          <MetricButton
            key={`${item.key}-${i}`}
            item={item}
            loading={loading}
            onJump={onJump}
          />
        ))}
      </div>
    </div>
  )
}

function MetricButton({
  item,
  loading,
  onJump,
}: {
  item: {
    key: 'leads' | 'drafts' | 'sent'
    label: string
    value: number | null
    helper: string
  }
  loading: boolean
  onJump: (tab: 'leads' | 'drafts' | 'sent') => void
}) {
  return (
    <button
      type="button"
      aria-label={`${item.label} ${item.value === null ? '-' : item.value}`}
      onClick={() => onJump(item.key)}
      disabled={loading}
      className="group flex min-h-[86px] items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-warm-50 disabled:cursor-wait disabled:opacity-60"
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">
          {item.label}
        </span>
        <span className="mt-1 block text-xs text-muted">
          {item.helper}
        </span>
      </span>
      <span className="font-display text-3xl font-semibold leading-none tabular-nums text-dark">
        {item.value === null ? '-' : item.value}
      </span>
    </button>
  )
}

export function LeadsTab() {
  const { campaign, workspaceConfig } = useWorkspaceContext()
  // Phase 4a: mount the existing Discover surface in-place. The campaign
  // doubles as activeCampaign (so saved leads land in this campaign) and
  // as campaignFilters (it carries all filter* fields directly). Navigation
  // props are intentionally undefined - the workspace header owns navigation
  // now, so the toast actions and the "exit campaign" X are dropped.
  return (
    <LeadDiscoveryTab
      workspaceConfig={workspaceConfig}
      activeCampaign={{ id: campaign.id, name: campaign.name }}
      campaignFilters={campaign}
    />
  )
}

export function ContactsSubTab() {
  const { campaign } = useWorkspaceContext()
  const navigate = useNavigate()
  return (
    <ContactsTab
      campaignId={campaign.id}
      templateId={campaign.templateId}
      attachmentIds={campaign.attachmentIds}
      tone={campaign.tone}
      onJumpToDrafts={() => navigate(`/campaigns/${campaign.id}/drafts`)}
      onJumpToLeads={() => navigate(`/campaigns/${campaign.id}/leads`)}
    />
  )
}

export function DraftsSubTab() {
  const { campaign, workspaceConfig, profile, profileLoading, onRefreshProfile } = useWorkspaceContext()
  const navigate = useNavigate()
  // Phase 4b: mount the existing Drafts queue scoped to this campaign.
  // `lockedTab='draft'` hides the Drafts/Sent segmented control inside the
  // component - the workspace already has Drafts and Sent as separate URLs,
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
        onRefreshProfile={onRefreshProfile}
        onNavigate={(target) => {
          // Empty-state CTAs jump to the matching workspace sub-tab.
          if (target === 'settings') navigate('/settings')
          else if (target === 'contacts') navigate(`/campaigns/${campaign.id}/contacts`)
          else if (target === 'leads') navigate(`/campaigns/${campaign.id}/leads`)
          else if (target === 'drafts') navigate(`/campaigns/${campaign.id}/drafts`)
        }}
      />
    </div>
  )
}

// Surface server-side generation availability before the user tries to draft.
function ClaudeKeyMissingBanner({ profile, profileLoading }: { profile: any; profileLoading: boolean }) {
  if (profileLoading || profile?.hasClaudeKey) return null
  return (
    <Banner variant="warning" icon={KeyRound}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span>Draft generation is unavailable on this deployment.</span>
        <Link to="/settings" className="shrink-0 font-semibold underline-offset-2 hover:underline">
          Open Settings →
        </Link>
      </div>
    </Banner>
  )
}

export function SentTab() {
  const { campaign, workspaceConfig, profile, profileLoading, onRefreshProfile } = useWorkspaceContext()
  const navigate = useNavigate()
  // Phase 4c: same DraftsTab component, locked to the sent list. The component
  // gates Send/Edit/Delete/attachment controls on `tab === 'draft'` already, so
  // the sent rows are read-only by construction.
  return (
    <div className="space-y-4">
      <ReplyTrackingBanner profile={profile} profileLoading={profileLoading} />
      <DraftsTab
        campaignId={campaign.id}
        lockedTab="sent"
        workspaceConfig={workspaceConfig}
        profile={profile}
        profileLoading={profileLoading}
        onRefreshProfile={onRefreshProfile}
        onNavigate={(target) => {
          if (target === 'settings') navigate('/settings')
          else if (target === 'contacts' || target === 'leads') navigate(`/campaigns/${campaign.id}/leads`)
          else if (target === 'drafts') navigate(`/campaigns/${campaign.id}/drafts`)
        }}
      />
    </div>
  )
}

function ReplyTrackingBanner({ profile, profileLoading }: { profile: any; profileLoading: boolean }) {
  if (profileLoading || !profile?.hasGoogleRefreshToken || profile?.hasGmailWatch) return null
  return (
    <Banner variant="info" icon={MessageSquare}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span>Enable reply tracking — reconnect Gmail to see when recipients reply.</span>
        <Link to="/settings" className="shrink-0 font-semibold underline-offset-2 hover:underline">
          Reconnect Gmail →
        </Link>
      </div>
    </Banner>
  )
}

export { SettingsTabImpl as SettingsTab }
