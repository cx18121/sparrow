import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, ArrowRight, CheckCircle2, Circle, FileText, Inbox,
  Send, Users,
} from 'lucide-react'
import Banner from '../ui/Banner'
import EmptyState from '../ui/EmptyState'
import { fetchEmails } from '../../lib/api'

const EMAIL_CACHE_KEY = 'cf_dash_emails'
function readEmailCache() {
  try { return JSON.parse(sessionStorage.getItem(EMAIL_CACHE_KEY) || 'null') } catch { return null }
}
function writeEmailCache(data) {
  try { sessionStorage.setItem(EMAIL_CACHE_KEY, JSON.stringify(data)) } catch {}
}

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

function Stat({ label, value, detail, loading, onClick }) {
  const display = loading && (value === 0 || value === null || value === undefined) ? '—' : value
  const inner = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">{label}</div>
      <div className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em] text-dark tabular-nums">
        {display}
      </div>
      {detail && <div className="mt-0.5 truncate text-xs text-muted">{detail}</div>}
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 px-4 py-3 text-left transition-colors hover:bg-slate-50 first:pl-0 last:pr-0"
      >
        {inner}
      </button>
    )
  }
  return <div className="min-w-0 px-4 py-3 first:pl-0 last:pr-0">{inner}</div>
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
  profile = null,
  profileLoading = true,
  onNavigate,
  onConnectGoogle,
}) {
  const cached = readEmailCache()
  const [emailState, setEmailState] = useState(
    cached
      ? { loading: false, drafts: cached.drafts || [], sent: cached.sent || [], error: null }
      : { loading: true, drafts: [], sent: [], error: null }
  )

  useEffect(() => {
    let cancelled = false
    if (!cached) setEmailState(s => ({ ...s, loading: true, error: null }))
    Promise.all([
      fetchEmails({ status: 'draft', limit: '8' }),
      fetchEmails({ status: 'sent', limit: '50' }),
    ])
      .then(([drafts, sent]) => {
        if (!cancelled) {
          const next = { drafts: drafts?.items || [], sent: sent?.items || [] }
          setEmailState({ loading: false, ...next, error: null })
          writeEmailCache(next)
        }
      })
      .catch(err => {
        if (!cancelled) setEmailState(s => ({ ...s, loading: false, error: err.message || 'Could not load email activity' }))
      })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hasClaude = !!workspaceConfig?.apiKeys?.claude || !!profile?.hasClaudeKey
  const hasGoogle = !!profile?.hasGoogleRefreshToken
  const hasResume = !!workspaceConfig?.resumeText?.trim() || !!workspaceConfig?.resumeFileName || !!profile?.resumeText
  const hasSender = !!workspaceConfig?.senderName?.trim()
  const hasTemplate = !!workspaceConfig?.templateId || templates.length > 0
  const activeCampaigns = campaigns.filter(campaign => campaign.status === 'active').length
  const totalContacts = leads.length + customContacts.length
  const readyDrafts = emailState.drafts.filter(email => {
    const hasRecipient = email.contact?.email || email.customContact?.email
    return hasRecipient && email.subject?.trim() && email.body?.trim()
  }).length

  const sentThisWeek = useMemo(() =>
    emailState.sent.filter(email => {
      const d = new Date(email.sentAt || email.updatedAt || '')
      return !isNaN(d.getTime()) && Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000
    }).length
  , [emailState.sent])

  const setupItems = [
    {
      label: 'Google connected',
      detail: hasGoogle ? 'Connected.' : 'Connect Google to enable Gmail sending.',
      done: hasGoogle,
      action: onConnectGoogle ? { label: 'Connect', onClick: onConnectGoogle } : null,
    },
    {
      label: 'Claude key added',
      detail: hasClaude ? 'Ready.' : 'Add a Claude key to generate drafts.',
      done: hasClaude,
      action: onNavigate ? { label: 'Settings', onClick: () => onNavigate('settings') } : null,
    },
    {
      label: 'Background added',
      detail: hasResume ? 'Added.' : 'Add a resume or bio.',
      done: hasResume,
      action: onNavigate ? { label: 'Settings', onClick: () => onNavigate('settings') } : null,
    },
    {
      label: 'Sender set',
      detail: hasSender ? `Drafting as ${workspaceConfig.senderName}.` : 'Set your sender name.',
      done: hasSender,
      action: onNavigate ? { label: 'Settings', onClick: () => onNavigate('settings') } : null,
    },
    {
      label: 'Template selected',
      detail: hasTemplate ? 'Template set.' : 'Create or select a template.',
      done: hasTemplate,
      action: onNavigate ? { label: 'Templates', onClick: () => onNavigate('templates') } : null,
    },
    {
      label: 'First contacts saved',
      detail: totalContacts > 0 ? `${totalContacts} contact${totalContacts !== 1 ? 's' : ''} saved.` : 'Find contacts in Discover or add manually.',
      done: totalContacts > 0,
      action: onNavigate ? { label: 'Contacts', onClick: () => onNavigate('contacts') } : null,
    },
  ]

  const completedSetup = setupItems.filter(item => item.done).length
  // Don't evaluate until profile has loaded — avoids the checklist flickering
  // in as "incomplete" then immediately disappearing once hasGoogle/hasClaude resolve.
  const setupReady = !profileLoading
  const setupComplete = setupReady && completedSetup === setupItems.length
  const firstIncompleteIndex = setupItems.findIndex(item => !item.done)

  // Merge sent + saved into one chronological feed, most recent first
  const recentActivity = useMemo(() => {
    const sent = emailState.sent
      .map(email => ({
        id: `sent-${email.id}`,
        type: 'sent',
        at: email.sentAt || email.updatedAt,
        title: email.subject || 'Sent email',
        detail: `${getEmailContact(email)}${getEmailCompany(email) ? ` at ${getEmailCompany(email)}` : ''}`,
      }))
      .filter(item => item.at)

    const saved = leads
      .map(lead => ({
        id: `lead-${lead.id}`,
        type: 'saved',
        at: lead.addedAt,
        title: lead.company?.name || lead.contact?.name || 'Saved contact',
        detail: lead.contact?.name ? `${lead.contact.name}${lead.contact.title ? `, ${lead.contact.title}` : ''}` : 'Saved from Discover',
      }))
      .filter(item => item.at)

    return [...sent, ...saved]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 8)
  }, [emailState.sent, leads])

  const hasSentInFeed = recentActivity.some(item => item.type === 'sent')

  // Context-aware primary action: keep the user on the next useful step.
  const primaryCta = readyDrafts > 0
    ? { label: 'Review drafts', icon: Inbox, onClick: () => onNavigate?.('drafts') }
    : totalContacts > 0
      ? { label: 'Generate drafts', icon: FileText, onClick: () => onNavigate?.('contacts') }
      : { label: 'Find contacts', icon: Users, onClick: () => onNavigate?.('leads') }

  const firstName = workspaceConfig?.senderName?.trim().split(' ')[0] || ''

  return (
    <div className="page-shell">
      <section className="page-toolbar">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="page-eyebrow">Dashboard</p>
            {firstName && (
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.04em] text-dark">
                Hi, {firstName}
              </h1>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={primaryCta.onClick} className="btn-primary text-xs">
              <primaryCta.icon size={13} /> {primaryCta.label}
            </button>
            {emailState.drafts.length > 0 && (
              <button type="button" onClick={() => onNavigate?.('drafts')} className="btn-secondary text-xs">
                <Inbox size={13} /> All drafts
              </button>
            )}
          </div>
        </div>
      </section>

      {emailState.error && (
        <Banner variant="warning" icon={AlertCircle}>
          {emailState.error}
        </Banner>
      )}

      <div className={`grid gap-6 ${setupReady && !setupComplete ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
        <section className="space-y-6">
          {/* Stat strip — ordered by workflow: Contacts → Drafts → Sent → Campaigns */}
          <div className="grid grid-cols-2 divide-x divide-slate-100 border-y border-slate-100 md:grid-cols-4">
            <Stat
              label="Contacts"
              value={totalContacts}
              detail={`${leads.length} leads, ${customContacts.length} custom`}
              loading={dataLoading}
              onClick={onNavigate ? () => onNavigate('contacts') : undefined}
            />
            <Stat
              label="Drafts"
              value={emailState.drafts.length}
              detail={
                emailState.loading ? undefined
                : readyDrafts > 0 ? `${readyDrafts} ready to send`
                : emailState.drafts.length > 0 ? 'none ready yet'
                : 'no drafts yet'
              }
              loading={emailState.loading}
              onClick={onNavigate ? () => onNavigate('drafts') : undefined}
            />
            <Stat
              label="Sent"
              value={emailState.sent.length}
              detail={emailState.loading ? undefined : sentThisWeek > 0 ? `${sentThisWeek} this week` : undefined}
              loading={emailState.loading}
              onClick={onNavigate ? () => onNavigate('drafts') : undefined}
            />
            <Stat
              label="Campaigns"
              value={campaigns.length}
              detail={`${activeCampaigns} active`}
              loading={dataLoading}
              onClick={onNavigate ? () => onNavigate('campaigns') : undefined}
            />
          </div>

          {/* Unified recent activity feed */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-dark">Recent activity</h2>
              {hasSentInFeed && (
                <button
                  type="button"
                  onClick={() => onNavigate?.('drafts')}
                  className="btn-ghost px-2 py-1 text-xs"
                >
                  View sent <ArrowRight size={11} />
                </button>
              )}
            </div>
            {emailState.loading ? (
              <div className="divide-y divide-slate-100 border-y border-slate-100">
                {Array.from({ length: 3 }).map((_, i) => <ActivitySkeleton key={i} />)}
              </div>
            ) : recentActivity.length === 0 ? (
              <EmptyState
                align="left"
                description="No activity yet. Save a contact to get started."
                action={
                  <button type="button" onClick={() => onNavigate?.('leads')} className="btn-ghost px-3 py-1.5 text-xs">
                    Find contacts <ArrowRight size={12} />
                  </button>
                }
                className="border-y border-slate-100"
              />
            ) : (
              <div className="divide-y divide-slate-100 border-y border-slate-100">
                {recentActivity.map(item => (
                  <ActivityRow
                    key={item.id}
                    icon={item.type === 'sent' ? Send : Users}
                    title={item.title}
                    detail={item.detail}
                    when={formatRelative(item.at)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {setupReady && !setupComplete && (
          <aside>
            <div className="rounded-2xl border border-slate-100 bg-white px-4 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="page-eyebrow">Setup</p>
                <span className="text-xs text-muted tabular-nums">
                  {completedSetup} / {setupItems.length}
                </span>
              </div>
              <h2 className="mt-2 text-base font-semibold text-dark">Finish setup</h2>

              <div className="mt-4 divide-y divide-slate-100">
                {setupItems.map((item, index) => (
                  <SetupItem
                    key={item.label}
                    item={item}
                    primary={index === firstIncompleteIndex}
                  />
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
