import { Send, ShieldAlert, User } from 'lucide-react'

export const GOOGLE_ERROR_COPY: Record<string, string> = {
  callback_failed: 'Could not connect Gmail - Google rejected the sign-in. Try again, or remove access at myaccount.google.com first.',
  missing_code: 'Gmail connection failed - sign-in did not complete. Try again.',
  missing_refresh_token: 'Gmail connection failed - Google did not issue a refresh token. Remove access at myaccount.google.com and reconnect.',
  profile_save_failed: 'Could not save your Gmail token. Try again, or contact support if this keeps happening.',
  missing_google_config: 'Gmail integration is not configured on the server. Contact support.',
}

export function getGoogleErrorMessage(code: string | null) {
  if (!code) return ''
  return GOOGLE_ERROR_COPY[code] ?? `Could not connect Gmail (${code}). Try again.`
}

export const SETTINGS_TABS = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'sending', label: 'Sending', icon: Send },
  { key: 'account', label: 'Account', icon: ShieldAlert },
] as const

export type SettingsTabKey = typeof SETTINGS_TABS[number]['key']
export type SetupStatus = 'ok' | 'warn' | null

export function hasRecoverableCompletedSetup(profile: { workspaceConfig?: any } | null | undefined) {
  const config = profile?.workspaceConfig || {}
  const hasSender = Boolean(config.senderName?.trim?.())
  const hasTemplate = Boolean(
    config.templateId ||
    (config.customTemplate?.subject?.trim?.() && config.customTemplate?.body?.trim?.())
  )
  return Boolean(hasSender && hasTemplate)
}

export function profileSetupSummary(input: { workspaceConfig?: any; profile?: any }) {
  const { workspaceConfig, profile } = input
  const hasGoogle = !!profile?.hasGoogleRefreshToken
  const hasResume = !!workspaceConfig?.resumeText?.trim?.() || !!workspaceConfig?.resumeFileName || !!profile?.resumeText
  const hasSender = !!workspaceConfig?.senderName?.trim?.()
  const incomplete = [
    !hasSender || !hasResume ? 'profile' : null,
    !hasGoogle ? 'account' : null,
  ].filter((value): value is 'profile' | 'account' => Boolean(value))

  return { hasGoogle, hasResume, hasSender, incomplete }
}

export function getSettingsTabStatus(input: { workspaceConfig?: any; profile?: any }): Record<SettingsTabKey, SetupStatus> {
  const setup = profileSetupSummary(input)
  return {
    profile: setup.hasSender && setup.hasResume ? 'ok' : 'warn',
    sending: null,
    account: setup.hasGoogle ? 'ok' : 'warn',
  }
}
