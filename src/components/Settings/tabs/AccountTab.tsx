import { useState } from 'react'
import { LogOut, Mail, MessageSquare, RefreshCw, Send as SendIcon, Trash2 } from 'lucide-react'
import { deleteAccount } from '../../../lib/api'
import ConfirmDialog from '../../ui/ConfirmDialog'
import { useAuth } from '../../../contexts/AuthContext'
import { CapabilityRow, FieldGroup } from '../_primitives'

export default function AccountTab({
  profile, profileLoading, onRefreshProfile, onConnectGoogle, gmailOnly = false,
}: {
  profile: any
  profileLoading: boolean
  onRefreshProfile: () => void
  onConnectGoogle: (() => void) | null
  gmailOnly?: boolean
}) {
  const { user, signOut } = useAuth()
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const hasGoogle = !!profile?.hasGoogleRefreshToken
  // Reply tracking depends on a separate Pub/Sub watch set up during
  // the OAuth callback. Users who connected before the gmail.readonly
  // scope shipped (or who hit a watch creation failure) have hasGoogle
  // but no watch — surface that explicitly so they know to reconnect.
  const hasReplyTracking = !!profile?.hasGmailWatch

  const handleDelete = async () => {
    setLoading(true); setError('')
    await deleteAccount()
    await signOut()
  }

  return (
    <div className="space-y-5">
      {!gmailOnly && (
        <FieldGroup title="Account">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-dark">{user?.email || 'Demo user'}</p>
              <p className="mt-0.5 text-xs text-muted">{user?.user_metadata?.full_name || 'No display name set'}</p>
            </div>
            <button type="button" onClick={signOut} className="btn-secondary text-xs">
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </FieldGroup>
      )}

      <FieldGroup title="Gmail">
        <div className="rounded-2xl border border-warm-200 bg-warm-50/60 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${hasGoogle ? 'bg-emerald-50 text-emerald-600' : 'bg-warm-100 text-muted'}`}>
                <Mail size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-dark">{hasGoogle ? 'Connected' : 'Not connected'}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {hasGoogle
                    ? 'Sparrow can send drafts and detect replies.'
                    : 'Connect to send drafts and detect replies.'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onRefreshProfile}
                disabled={profileLoading}
                className="btn-ghost text-xs"
                title="Refresh Gmail status"
              >
                <RefreshCw size={12} className={profileLoading ? 'animate-spin' : ''} /> Refresh
              </button>
              {onConnectGoogle && (
                <button type="button" onClick={onConnectGoogle} className="btn-primary text-xs">
                  {hasGoogle ? 'Reconnect' : 'Connect'}
                </button>
              )}
            </div>
          </div>
          {hasGoogle && (
            <div className="mt-3 grid gap-2 border-t border-warm-200 pt-3 sm:grid-cols-2">
              <CapabilityRow icon={SendIcon} label="Sending" enabled />
              <CapabilityRow
                icon={MessageSquare}
                label="Reply tracking"
                enabled={hasReplyTracking}
                disabledHint="Reconnect to enable"
              />
            </div>
          )}
        </div>
      </FieldGroup>

      {!gmailOnly && (
        <FieldGroup title="Danger zone">
          <div className="surface-danger flex items-start justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-dark">Delete account</p>
              <p className="mt-0.5 text-xs text-muted">
                Permanently delete your account and workspace data.
              </p>
              {error && <p className="mt-1 form-error-text">{error}</p>}
            </div>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="btn-danger-outline"
            >
              <Trash2 size={12} /> Delete account
            </button>
          </div>
        </FieldGroup>
      )}

      <ConfirmDialog
        open={confirm}
        title="Delete account"
        message="This permanently deletes your account, campaigns, leads, and emails."
        confirmLabel={loading ? 'Deleting…' : 'Yes, delete my account'}
        onConfirm={handleDelete}
        onClose={() => setConfirm(false)}
      />
    </div>
  )
}
