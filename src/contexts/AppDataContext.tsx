import React, { createContext, useContext } from 'react'
import type { Campaign, CustomContact, Template, UserLead } from '../types/api'

// Campaigns are stored UI-side with lowercase status; the wire format uses uppercase.
// See campaignToUi / campaignToApi in App.tsx.
export type UiCampaign = Omit<Campaign, 'status'> & { status: 'draft' | 'active' | 'paused' | 'completed' }

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
