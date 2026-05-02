import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, ArrowRight, CheckCircle2, Circle, FileText, Inbox,
  Mail, Send, Users,
} from 'lucide-react'
import Banner from '../ui/Banner'
import EmptyState from '../ui/EmptyState'
import { fetchEmails, fetchProfile } from '../../lib/api'

function formatRelative(value) {
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

function getEmailContact(email) {
  return email.contact?.name || email.customContact?.name || email.contact?.email || email.customContact?.email || 'Contact'
}

function getEmailCompany(email) {
  return email.userLead?.company?.name || email.customContact?.companyName || ''
}

// One-line stat. No card, no icon chip — keeps blue reserved for action/selection.
// Uses the DESIGN.md "Label" treatment for the eyebrow (not page-eyebrow, which
// is page-level and primary-blue).
function Stat({ label, value, detail, loading }) {
  const display = loading && (value === 0 || value === null || value === undefined) ? '—' : value
  return (
    <div className="min-w-0 px-4 py-3 first:pl-0 last:pr-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">{label}</div>
      <div className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em] text-dark tabular-nums">
        {display}
      </div>
      {detail && <div className="mt-0.5 truncate text-xs text-muted">{detail}</div>}
    </div>
  )
}

function ActivityRow({ icon: Icon, title, detail, when }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Icon size={14} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-dark">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted">{detail}</p>
      </div>
      {when && <span className="shrink-0 text-xs text-muted tabular-nums">{when}</span>}
    </div>
  )
}

function ActivitySkeleton() {
  return (
    <div className="flex items-center gap-3 py-3 animate-pulse">
      <div className="h-3.5 w-3.5 shrink-0 rounded-full bg-slate-100" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-2/5 rounded bg-slate-100" />
        <div className="h-2.5 w-1/3 rounded bg-slate-100" />
      </div>
      <div className="h-2.5 w-10 shrink-0 rounded bg-slate-100" />
    </div>
  )
}

function SetupItem({ item, primary }) {
  const Icon = item.done ? CheckCircle2 : Circle
  return (
    <div
      className={[
        'flex items-start gap-3 px-3 py-3 -mx-3 rounded-xl transition-colors duration-150',
        primary && !item.done ? 'bg-primary-50/70' : '',
      ].join(' ')}
    >
      <Icon
        size={15}
        className={`mt-0.5 shrink-0 ${item.done ? 'text-emerald-600' : primary ? 'text-primary' : 'text-slate-300'}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-dark">{item.label}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted">{item.detail}</p>
      </div>
      {item.action && !item.done && (
        <button type="button" onClick={item.action.onClick} className="btn-ghost shrink-0 text-xs px-2.5 py-1">
          {item.action.label} <ArrowRight size={11} />
        </button>
      )}
    </div>
  )
}

export default function DashboardTab({
  campaigns = [],
  leads = [],
  customContacts = [],
  templates = [],
  workspaceConfig,
  dataLoading = false,
  onNavigate,
  onGoToOnboarding,
  onConnectGoogle,
}) {
  const [profileState, setProfileState] = useState({ loading: true, profile: null, error: null })
  const [emailState, setEmailState] = useState({ loading: true, drafts: [], sent: [], error: null })

  useEffect(() => {
    let cancelled = false
    setProfileState(current => ({ ...current, loading: true, error: null }))
    fetchProfile()
      .then(res => {
        if (!cancelled) setProfileState({ loading: false, profile: res?.profile || null, error: null })
      })
      .catch(err => {
        if (!cancelled) setProfileState({ loading: false, profile: null, error: err.message || 'Could not load setup status' })
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setEmailState(current => ({ ...current, loading: true, error: null }))
    Promise.all([
      fetchEmails({ status: 'draft', limit: '8' }),
      fetchEmails({ status: 'sent', limit: '8' }),
    ])
      .then(([drafts, sent]) => {
        if (!cancelled) setEmailState({ loading: false, drafts: drafts?.items || [], sent: sent?.items || [], error: null })
      })
      .catch(err => {
        if (!cancelled) setEmailState({ loading: false, drafts: [], sent: [], error: err.message || 'Could not load email activity' })
      })
    return () => { cancelled = true }
  }, [])

  const hasClaude = !!workspaceConfig?.apiKeys?.claude || !!profileState.profile?.hasClaudeKey
  const hasGoogle = !!profileState.profile?.hasGoogleRefreshToken
  const hasResume = !!workspaceConfig?.resumeText?.trim() || !!workspaceConfig?.resumeFileName || !!profileState.profile?.resumeText
  const hasSender = !!workspaceConfig?.senderName?.trim()
  const hasTemplate = !!workspaceConfig?.templateId || templates.length > 0
  const activeCampaigns = campaigns.filter(campaign => campaign.status === 'active').length
  const totalContacts = leads.length + customContacts.length
  const readyDrafts = emailState.drafts.filter(email => {
    const hasRecipient = email.contact?.email || email.customContact?.email
    return hasRecipient && email.subject?.trim() && email.body?.trim()
  }).length

  const setupItems = [
    {
      label: 'Google connected',
      detail: hasGoogle ? 'Gmail sending is connected.' : 'Connect Google so Coldflow can send reviewed drafts.',
      done: hasGoogle,
      action: onConnectGoogle ? { label: 'Connect', onClick: onConnectGoogle } : null,
    },
    {
      label: 'Claude key added',
      detail: hasClaude ? 'AI drafting is ready.' : 'Add a Claude key before generating drafts.',
      done: hasClaude,
      action: onNavigate ? { label: 'Settings', onClick: () => onNavigate('settings') } : null,
    },
    {
      label: 'Background added',
      detail: hasResume ? 'Drafts can use your experience and offer.' : 'Add a resume, bio, or positioning note.',
      done: hasResume,
      action: onGoToOnboarding ? { label: 'Setup', onClick: onGoToOnboarding } : null,
    },
    {
      label: 'Sender set',
      detail: hasSender ? `${workspaceConfig.senderName} will appear in drafts.` : 'Set the sender name for outreach.',
      done: hasSender,
      action: onGoToOnboarding ? { label: 'Setup', onClick: onGoToOnboarding } : null,
    },
    {
      label: 'Template selected',
      detail: hasTemplate ? 'Drafts have a reusable starting structure.' : 'Create or choose a default template.',
      done: hasTemplate,
      action: onNavigate ? { label: 'Templates', onClick: () => onNavigate('templates') } : null,
    },
    {
      label: 'First contacts saved',
      detail: totalContacts > 0 ? `${totalContacts} contact${totalContacts !== 1 ? 's' : ''} saved.` : 'Save contacts from Discover or add them manually.',
      done: totalContacts > 0,
      action: onNavigate ? { label: 'Contacts', onClick: () => onNavigate('contacts') } : null,
    },
  ]

  const completedSetup = setupItems.filter(item => item.done).length
  const setupComplete = completedSetup === setupItems.length
  const firstIncompleteIndex = setupItems.findIndex(item => !item.done)

  const recentActivity = useMemo(() => {
    const campaignItems = campaigns.slice(0, 4).map(campaign => ({
      id: `campaign-${campaign.id}`,
      at: campaign.updatedAt || campaign.createdAt,
      icon: Mail,
      title: campaign.name,
      detail: `${campaign.status || 'draft'} campaign`,
    }))
    const leadItems = leads.slice(0, 4).map(lead => ({
      id: `lead-${lead.id}`,
      at: lead.addedAt,
      icon: Users,
      title: lead.company?.name || lead.contact?.name || 'Saved contact',
      detail: lead.contact?.name ? `${lead.contact.name}${lead.contact.title ? `, ${lead.contact.title}` : ''}` : 'Saved from Discover',
    }))
    const draftItems = emailState.drafts.slice(0, 4).map(email => ({
      id: `draft-${email.id}`,
      at: email.createdAt,
      icon: FileText,
      title: email.subject || 'Draft email',
      detail: `${getEmailContact(email)}${getEmailCompany(email) ? ` at ${getEmailCompany(email)}` : ''}`,
    }))
    const sentItems = emailState.sent.slice(0, 4).map(email => ({
      id: `sent-${email.id}`,
      at: email.sentAt || email.updatedAt,
      icon: Send,
      title: email.subject || 'Sent email',
      detail: `${getEmailContact(email)}${getEmailCompany(email) ? ` at ${getEmailCompany(email)}` : ''}`,
    }))

    return [...campaignItems, ...leadItems, ...draftItems, ...sentItems]
      .filter(item => item.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 7)
  }, [campaigns, emailState.drafts, emailState.sent, leads])

  // Context-aware primary action: keep the user on the next useful step.
  const primaryCta = readyDrafts > 0
    ? { label: 'Review drafts', icon: Inbox, onClick: () => onNavigate?.('drafts') }
    : totalContacts > 0
      ? { label: 'Generate drafts', icon: FileText, onClick: () => onNavigate?.('contacts') }
      : { label: 'Find contacts', icon: Users, onClick: () => onNavigate?.('leads') }

  return (
    <div className="page-shell">
      <section className="page-toolbar">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="page-eyebrow">Dashboard</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.04em] text-dark">
              {setupComplete ? 'Ready when you are' : 'Activity summary'}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={primaryCta.onClick} className="btn-primary text-xs">
              <primaryCta.icon size={13} /> {primaryCta.label}
            </button>
            <button type="button" onClick={() => onNavigate?.('drafts')} className="btn-secondary text-xs">
              <Inbox size={13} /> All drafts
            </button>
          </div>
        </div>
      </section>

      {(profileState.error || emailState.error) && (
        <Banner variant="warning" icon={AlertCircle}>
          {profileState.error || emailState.error}
        </Banner>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-6">
          {/* Stat strip — inline, no cards, no icon chips, divider rhythm */}
          <div className="grid grid-cols-2 divide-x divide-slate-100 border-y border-slate-100 md:grid-cols-4">
            <Stat
              label="Campaigns"
              value={campaigns.length}
              detail={`${activeCampaigns} active`}
              loading={dataLoading}
            />
            <Stat
              label="Contacts"
              value={totalContacts}
              detail={`${leads.length} leads, ${customContacts.length} custom`}
              loading={dataLoading}
            />
            <Stat
              label="Drafts"
              value={emailState.drafts.length}
              detail={`${readyDrafts} ready to send`}
              loading={emailState.loading}
            />
            <Stat
              label="Templates"
              value={templates.length}
              detail={workspaceConfig?.templateId ? 'Default selected' : 'No default yet'}
              loading={dataLoading}
            />
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-dark">Recent activity</h2>
            </div>
            {emailState.loading ? (
              <div className="divide-y divide-slate-100 border-y border-slate-100">
                {Array.from({ length: 5 }).map((_, i) => (
                  <ActivitySkeleton key={i} />
                ))}
              </div>
            ) : recentActivity.length === 0 ? (
              <EmptyState
                align="left"
                description="Nothing yet. Save contacts from Discover or import your own to get started."
                action={
                  <button
                    type="button"
                    onClick={() => onNavigate?.('leads')}
                    className="btn-ghost px-3 py-1.5 text-xs"
                  >
                    Open Discover <ArrowRight size={12} />
                  </button>
                }
                className="border-y border-slate-100"
              />
            ) : (
              <div className="divide-y divide-slate-100 border-y border-slate-100">
                {recentActivity.map(item => (
                  <ActivityRow
                    key={item.id}
                    icon={item.icon}
                    title={item.title}
                    detail={item.detail}
                    when={formatRelative(item.at)}
                  />
                ))}
              </div>
            )}
          </section>
        </section>

        <aside>
          <section>
            <div className="flex items-baseline justify-between gap-3">
              <p className="page-eyebrow">Setup</p>
              <span className="text-xs text-muted tabular-nums">
                {completedSetup} / {setupItems.length}
              </span>
            </div>
            <h2 className="mt-2 text-base font-semibold text-dark">
              {setupComplete ? 'Everything is connected' : 'Finish setup'}
            </h2>

            <div className="mt-4 divide-y divide-slate-100">
              {setupItems.map((item, index) => (
                <SetupItem
                  key={item.label}
                  item={item}
                  primary={index === firstIncompleteIndex}
                />
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
