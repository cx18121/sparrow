import React, { createContext, useContext } from 'react'
import type { Campaign, CustomContact, Template, UserLead } from '../types/api'

// Campaigns are stored UI-side with lowercase status; the wire format uses uppercase.
// See wireToUi / uiToWire in src/lib/api.ts.
//
// Per PRD: only Active / Paused / Completed are valid. DRAFT was a legacy state
// that the server now coerces to PAUSED on read, so the UI never sees it.
export type UiCampaign = Omit<Campaign, 'status'> & { status: 'active' | 'paused' | 'completed' }

export interface AppDataContextValue {
  campaigns: UiCampaign[]
  leads: UserLead[]
  customContacts: CustomContact[]
  templates: Template[]
  dataLoaded: boolean
  hasResourceCache: boolean

  createCampaign: (data: Partial<UiCampaign>) => Promise<UiCampaign>
  updateCampaign: (data: Partial<UiCampaign> & { id: string }) => Promise<UiCampaign>
  deleteCampaign: (id: string) => Promise<void>

  refreshLeads: () => Promise<void>
  updateLead: (data: { id: string; status?: string; notes?: string | null }) => Promise<UserLead>
  deleteLead: (id: string) => Promise<void>

  createCustomContact: (data: Partial<CustomContact>) => Promise<CustomContact>
  updateCustomContact: (data: Partial<CustomContact> & { id: string }) => Promise<CustomContact>
  deleteCustomContact: (id: string) => Promise<void>

  createTemplate: (data: Partial<Template>) => Promise<Template>
  updateTemplate: (data: Partial<Template> & { id: string }) => Promise<Template>
  deleteTemplate: (id: string) => Promise<void>
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

export function AppDataProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: AppDataContextValue
}) {
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider')
  return ctx
}
