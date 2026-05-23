import { Mail, RefreshCw } from 'lucide-react'
import Banner from '../../ui/Banner'
import StepHeader, { TOTAL_STEPS } from '../StepHeader'

export default function GmailStep({
  hasGoogle,
  hasReplyTracking,
  profileLoading,
  isConnecting,
  connectError,
  onConnectGoogle,
  onRefreshProfile,
}: {
  hasGoogle: boolean
  hasReplyTracking: boolean
  profileLoading: boolean
  isConnecting: boolean
  connectError: string
  onConnectGoogle: () => void
  onRefreshProfile: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <StepHeader
        step={3}
        total={TOTAL_STEPS}
        title="Connect Gmail"
        description="Grant send + inbox-read permission so Sparrow can send approved drafts and tell you when replies land."
      />

      <div className="rounded-2xl border border-warm-200 bg-warm-50/70 px-5 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${hasGoogle ? 'bg-emerald-50 text-emerald-600' : 'bg-warm-100 text-muted'}`}>
              <Mail size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-dark">{hasGoogle ? 'Gmail connected' : 'Gmail not connected'}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">
                {hasGoogle
                  ? (hasReplyTracking
                      ? 'You can send drafts after reviewing them, and Sparrow will flag replies as they arrive.'
                      : 'Sending is ready, but reply tracking is not active. Reconnect to enable it.')
                  : 'You will review drafts before anything is sent. Connecting also enables reply tracking.'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!hasGoogle && (
              <button
                type="button"
                onClick={onConnectGoogle}
                disabled={isConnecting}
                className="btn-primary text-xs"
              >
                {isConnecting ? 'Connecting...' : 'Connect Gmail'}
              </button>
            )}
            {hasGoogle && !hasReplyTracking && (
              <button
                type="button"
                onClick={onConnectGoogle}
                disabled={isConnecting}
                className="btn-primary text-xs"
              >
                {isConnecting ? 'Reconnecting...' : 'Reconnect for replies'}
              </button>
            )}
            <button
              type="button"
              onClick={onRefreshProfile}
              disabled={profileLoading}
              className="btn-ghost text-xs"
              title="Refresh Gmail status"
            >
              <RefreshCw size={12} className={profileLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {connectError && (
        <Banner variant="danger" className="mt-4">{connectError}</Banner>
      )}
    </div>
  )
}
