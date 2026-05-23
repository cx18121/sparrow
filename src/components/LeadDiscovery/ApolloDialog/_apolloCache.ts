// Cache shared between LeadDiscoveryTab (parent) and ApolloDialog so the
// dialog can close and reopen without re-spending Apollo credits. Lifted
// out of the dialog because dialog state evaporates on close/remount —
// see the keyed remount in LeadDiscoveryTab.
import type { ApolloPreview } from '../../../types/api'

// undefined = resolving (request in flight); null = no email; string = email.
export type EmailRevealState = string | null | undefined

export interface ApolloPreviewBundle {
  previews: ApolloPreview[]
  usedFallback: boolean
}

export interface ApolloCache {
  // Keyed by companyId: skip the apolloSearch call on reopen for the same company.
  previews: Record<string, ApolloPreviewBundle>
  // Keyed by apollo personId (globally unique across companies): skip
  // re-revealing a contact we've already attempted, even on a different company.
  revealedEmails: Record<string, EmailRevealState>
}

export const emptyApolloCache = (): ApolloCache => ({ previews: {}, revealedEmails: {} })
