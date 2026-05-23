import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check } from 'lucide-react'
import Banner from '../ui/Banner'
import { useToast } from '../../contexts/ToastContext'
import { getGoogleErrorMessage, getSettingsTabStatus, SETTINGS_TABS, type SettingsTabKey } from '../../lib/profileSetup'
import ProfileTab from './tabs/ProfileTab'
import SendingTab from './tabs/SendingTab'
import AccountTab from './tabs/AccountTab'

const TABS = SETTINGS_TABS
type TabKey = SettingsTabKey

// Tab nav --------------------------------------------------------------------

function TabBar({ active, onChange, status }: {
  active: TabKey
  onChange: (t: TabKey) => void
  status: Record<TabKey, 'ok' | 'warn' | null>
}) {
  return (
    <nav role="tablist" aria-label="Settings sections" className="sticky top-0 z-10 flex flex-wrap gap-1 overflow-x-clip border-b border-warm-200 bg-surface/95 pt-1 backdrop-blur">
      {TABS.map(t => {
        const isActive = active === t.key
        const Icon = t.icon
        const dot = status[t.key]
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={`relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'text-dark after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                : 'text-muted hover:text-dark'
            }`}
          >
            <Icon size={14} />
            {t.label}
            {dot === 'warn' && (
              <span aria-hidden className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" title="Setup incomplete" />
            )}
          </button>
        )
      })}
    </nav>
  )
}

// Page -----------------------------------------------------------------------

export default function SettingsPage({
  workspaceConfig, onSaveWorkspaceConfig, templates,
  profile, profileLoading, onRefreshProfile, onConnectGoogle,
}: any) {
  const { showToast } = useToast()
  const [oauthResult, setOauthResult] = useState<{ kind: 'success' } | { kind: 'error'; message: string } | null>(null)
  const [active, setActive] = useState<TabKey>('profile')
  // Tracks the active tab's dirty state so switching tabs while unsaved
  // edits exist can confirm before unmounting the form. Only the active
  // tab is mounted at a time, so one flag is enough.
  const activeDirtyRef = useRef(false)
  const handleDirtyChange = useCallback((dirty: boolean) => {
    activeDirtyRef.current = dirty
  }, [])
  const handleTabChange = useCallback((next: TabKey) => {
    if (activeDirtyRef.current && !window.confirm('You have unsaved changes. Switch tabs and lose them?')) return
    activeDirtyRef.current = false
    setActive(next)
  }, [])

  // The Gmail OAuth callback at /api/google/callback redirects back here with
  // either ?google_connected=1 (success) or ?google_error=<code> (failure).
  // Read the params, surface a banner, then strip them from the URL so a
  // refresh does not re-fire the banner.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('google_error')
    const success = params.get('google_connected')
    if (!error && !success) return
    setOauthResult(error ? { kind: 'error', message: getGoogleErrorMessage(error) } : { kind: 'success' })
    if (error || success) {
      setActive('account')
      if (success) onRefreshProfile?.()
    }
    params.delete('google_error')
    params.delete('google_connected')
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
    window.history.replaceState(null, '', next)
  }, [onRefreshProfile])

  const saveWorkspace = async (updater: any, label = 'Settings saved') => {
    try {
      await onSaveWorkspaceConfig(updater)
      showToast({ type: 'success', title: label })
      return true
    } catch (err: any) {
      showToast({ type: 'error', title: 'Settings could not be saved', message: err?.message || 'Try again.' })
      return false
    }
  }

  // Wrap onConnectGoogle so any synchronous error returned by the auth
  // context (demo-mode rejection, network failure before redirect) is
  // surfaced as a banner instead of disappearing silently.
  const handleConnect = onConnectGoogle ? async () => {
    const res = await onConnectGoogle()
    if (res?.error?.message) setOauthResult({ kind: 'error', message: res.error.message })
  } : null

  const tabStatus = getSettingsTabStatus({ workspaceConfig, profile })

  return (
    <div className="page-shell max-w-5xl">
      <div className="workspace">
        <header className="border-b border-warm-200 px-6 pb-6 pt-8 sm:px-10 sm:pt-10">
          <p className="page-eyebrow">Settings</p>
          <h1 className="mt-3 font-display text-[2rem] font-semibold leading-tight text-dark">Your workspace</h1>
          <p className="mt-2 text-sm text-muted">Profile, sending, account.</p>
        </header>

        {oauthResult && (
          <div className="border-b border-warm-200 px-6 py-4 sm:px-10">
            {oauthResult.kind === 'success' && (
              profile?.hasGmailWatch ? (
                <Banner variant="success" icon={Check}>
                  Gmail connected. Sending and reply tracking are both active.
                </Banner>
              ) : (
                <Banner variant="warning" icon={AlertCircle}>
                  Gmail connected for sending. Reply tracking did not enable — try reconnecting.
                </Banner>
              )
            )}
            {oauthResult.kind === 'error' && (
              <Banner variant="danger" icon={AlertCircle}>{oauthResult.message}</Banner>
            )}
          </div>
        )}

        <div className="border-b border-warm-200 px-3 sm:px-7">
          <TabBar active={active} onChange={handleTabChange} status={tabStatus} />
        </div>

        <div className="px-6 py-6 sm:px-10 sm:py-8">
          {active === 'profile' && (
            <ProfileTab
              workspaceConfig={workspaceConfig}
              onSave={(updater) => saveWorkspace(updater, 'Profile saved')}
              onDirtyChange={handleDirtyChange}
            />
          )}
          {active === 'sending' && (
            <SendingTab
              workspaceConfig={workspaceConfig}
              templates={templates}
              onSave={(updater) => saveWorkspace(updater, 'Sending settings saved')}
              onDirtyChange={handleDirtyChange}
            />
          )}
          {active === 'account' && (
            <AccountTab
              profile={profile}
              profileLoading={profileLoading}
              onRefreshProfile={onRefreshProfile}
              onConnectGoogle={handleConnect}
            />
          )}
        </div>
      </div>
    </div>
  )
}
