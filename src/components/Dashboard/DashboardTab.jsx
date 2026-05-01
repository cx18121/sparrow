import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, ArrowRight, CheckCircle2, Circle, FileText, Inbox,
  Mail, RefreshCw, Send, Sparkles, Target, Users,
} from 'lucide-react'
import { fetchEmails, fetchProfile } from '../../lib/api'

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getEmailContact(email) {
  return email.contact?.name || email.customContact?.name || email.contact?.email || email.customContact?.email || 'Contact'
}

function getEmailCompany(email) {
  return email.userLead?.company?.name || email.customContact?.companyName || ''
}

function SetupChecklist({ items }) {
  const completeCount = items.filter(item => item.done).length
  const complete = completeCount === items.length

  return (
    <section className="border-b border-slate-100 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="page-eyebrow">Setup</p>
          <h2 className="mt-2 text-xl font-semibold text-dark">
            {complete ? 'Ready to send' : `${completeCount} of ${items.length} complete`}
          </h2>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-semibold ${complete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {complete ? 'Ready' : 'Needs attention'}
        </div>
      </div>

      <div className="mt-4 divide-y divide-slate-100">
        {items.map(item => {
          const Icon = item.done ? CheckCircle2 : Circle
          return (
            <div key={item.label} className="flex items-start gap-3 py-3">
              <Icon size={15} className={`mt-0.5 shrink-0 ${item.done ? 'text-emerald-600' : 'text-slate-300'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-dark">{item.label}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted">{item.detail}</p>
              </div>
              {item.action && !item.done && (
                <button type="button" onClick={item.action.onClick} className="shrink-0 text-xs font-semibold text-primary hover:underline">
                  {item.action.label}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SummaryMetric({ icon: Icon, label, value, detail }) {
  return (
    <div className="border-b border-slate-100 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted/80">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-dark">{value}</p>
          <p className="mt-1 text-xs text-muted">{detail}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon size={18} />
        </div>
      </div>
    </div>
  )
}

function ActivityRow({ icon: Icon, title, detail, date }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-dark">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted">{detail}</p>
      </div>
      {date && <span className="shrink-0 text-xs text-muted">{date}</span>}
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
      action: onGoToOnboarding ? { label: 'Setup', onClick: onGoToOnboarding } : null,
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

  return (
    <div className="page-shell">
      <section className="page-toolbar">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="page-eyebrow">Dashboard</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.04em] text-dark">Activity summary</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Track setup readiness, saved prospects, campaigns, and recent draft activity from one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onNavigate?.('contacts')} className="btn-primary text-xs">
              <Users size={13} /> Add contacts
            </button>
            <button type="button" onClick={() => onNavigate?.('drafts')} className="btn-secondary text-xs">
              <Inbox size={13} /> Review drafts
            </button>
          </div>
        </div>
      </section>

      {(profileState.error || emailState.error) && (
        <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle size={15} /> {profileState.error || emailState.error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <SummaryMetric icon={Target} label="Campaigns" value={campaigns.length} detail={`${activeCampaigns} active`} />
            <SummaryMetric icon={Users} label="Contacts" value={totalContacts} detail={`${leads.length} saved leads, ${customContacts.length} custom`} />
            <SummaryMetric icon={FileText} label="Drafts" value={emailState.loading && emailState.drafts.length === 0 ? '...' : emailState.drafts.length} detail={`${readyDrafts} ready to send`} />
            <SummaryMetric icon={Sparkles} label="Templates" value={templates.length} detail={workspaceConfig?.templateId ? 'Default selected' : 'Choose a default'} />
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-dark">Recent activity</h2>
              {(dataLoading || emailState.loading) && (
                <span className="inline-flex items-center gap-1 text-xs text-muted">
                  <RefreshCw size={12} className="animate-spin" /> Refreshing
                </span>
              )}
            </div>
            {recentActivity.length === 0 ? (
              <div className="empty-state border-b border-slate-100">
                Activity will appear here after you save contacts, create campaigns, or generate drafts.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border-b border-slate-100">
                {recentActivity.map(item => (
                  <ActivityRow
                    key={item.id}
                    icon={item.icon}
                    title={item.title}
                    detail={item.detail}
                    date={formatDate(item.at)}
                  />
                ))}
              </div>
            )}
          </section>
        </section>

        <aside className="space-y-5">
          <SetupChecklist items={setupItems} />

          <section className="border-b border-slate-100 pb-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted/80">Next step</p>
                <h2 className="mt-1 text-lg font-semibold text-dark">
                  {readyDrafts > 0 ? 'Review ready drafts' : totalContacts > 0 ? 'Generate drafts' : 'Add your first contacts'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.(readyDrafts > 0 ? 'drafts' : totalContacts > 0 ? 'contacts' : 'leads')}
                className="btn-secondary px-3 py-2 text-xs"
              >
                Open <ArrowRight size={13} />
              </button>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">
              {readyDrafts > 0
                ? `${readyDrafts} draft${readyDrafts !== 1 ? 's are' : ' is'} ready for review and sending.`
                : totalContacts > 0
                  ? 'Select contacts in Contacts and generate drafts in bulk.'
                  : 'Start in Discover or add contacts manually so Coldflow has people to write to.'}
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
