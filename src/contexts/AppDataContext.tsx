import React, { createContext, useContext } from 'react'

export interface AppDataContextValue {
  campaigns: any[]
  leads: any[]
  customContacts: any[]
  templates: any[]
  dataLoaded: boolean
  hasResourceCache: boolean

  createCampaign: (data: any) => Promise<any>
  updateCampaign: (data: any) => Promise<any>
  deleteCampaign: (id: string) => Promise<void>

  refreshLeads: () => Promise<void>
  updateLead: (data: any) => Promise<any>
  deleteLead: (id: string) => Promise<void>

  createCustomContact: (data: any) => Promise<any>
  updateCustomContact: (data: any) => Promise<any>
  deleteCustomContact: (id: string) => Promise<void>

  createTemplate: (data: any) => Promise<any>
  updateTemplate: (data: any) => Promise<any>
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
