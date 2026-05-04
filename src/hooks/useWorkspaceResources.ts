import { useCallback, useEffect, useState } from 'react'
import type { Campaign, CustomContact, Template, UserLead } from '../types/api'
import type { UiCampaign } from '../contexts/AppDataContext'
import {
  apiGetAuth,
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  fetchCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  fetchLeads,
  updateLead,
  deleteLead,
  fetchCustomContacts,
  createCustomContact,
  updateCustomContact,
  deleteCustomContact,
} from '../lib/api'

const getResourceCacheKey = (user: unknown) => {
  if (!user) return null
  if (typeof user === 'string') return `cf_resource_cache_${user}`
  const u = user as { id?: string; email?: string }
  return `cf_resource_cache_${u.id || u.email}`
}

const readJsonCache = (key: string | null) => {
  if (!key) return null
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

const writeJsonCache = (key: string | null, data: unknown) => {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // Cache writes should never block the app.
  }
}

export function readLocalJsonCache(key: string | null) {
  return readJsonCache(key)
}

export function useWorkspaceResources(user: unknown) {
  const [campaigns, setCampaigns] = useState<UiCampaign[]>([])
  const [leads, setLeads] = useState<UserLead[]>([])
  const [customContacts, setCustomContacts] = useState<CustomContact[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)
  const [hasResourceCache, setHasResourceCache] = useState(false)
  const [resourceFetchErrors, setResourceFetchErrors] = useState<string[]>([])
  const [resourceLoadCount, setResourceLoadCount] = useState(0)

  useEffect(() => {
    const { userId } = apiGetAuth()
    const effectiveUser = user || userId
    if (!effectiveUser) {
      setTemplates([])
      setCampaigns([])
      setLeads([])
      setCustomContacts([])
      setDataLoaded(false)
      setHasResourceCache(false)
      setResourceFetchErrors([])
      return
    }

    let cancelled = false
    const cacheKey = getResourceCacheKey(effectiveUser)
    const cached = readJsonCache(cacheKey)
    const cachedData = cached?.data || null

    if (cachedData) {
      setTemplates(cachedData.templates || [])
      setCampaigns(cachedData.campaigns || [])
      setLeads(cachedData.leads || [])
      setCustomContacts(cachedData.customContacts || [])
      setDataLoaded(true)
      setHasResourceCache(true)
    } else {
      setDataLoaded(false)
      setHasResourceCache(false)
    }

    const keepCachedOnError = (label: string, request: Promise<unknown>) =>
      request
        .then(res => ({ ok: true, res }))
        .catch(e => {
          console.error(`${label} failed:`, e.message)
          return { ok: false, res: null }
        })

    Promise.all([
      keepCachedOnError('templates', fetchTemplates()),
      keepCachedOnError('campaigns', fetchCampaigns()),
      keepCachedOnError('leads', fetchLeads()),
      keepCachedOnError('contacts', fetchCustomContacts()),
    ]).then(([t, c, l, cc]) => {
      if (cancelled) return
      setTemplates(t.ok ? ((t.res as { items?: Template[] })?.items || []) : (cachedData?.templates || []))
      setCampaigns(c.ok ? ((c.res as { items?: UiCampaign[] })?.items || []) : (cachedData?.campaigns || []))
      setLeads(l.ok ? ((l.res as { items?: UserLead[] })?.items || []) : (cachedData?.leads || []))
      setCustomContacts(cc.ok ? ((cc.res as { items?: CustomContact[] })?.items || []) : (cachedData?.customContacts || []))
      setDataLoaded(true)
      setHasResourceCache(true)
      const failed: string[] = []
      if (!t.ok) failed.push('templates')
      if (!c.ok) failed.push('campaigns')
      if (!l.ok) failed.push('leads')
      if (!cc.ok) failed.push('contacts')
      setResourceFetchErrors(failed)
    })

    return () => { cancelled = true }
  }, [user, resourceLoadCount])

  useEffect(() => {
    const { userId } = apiGetAuth()
    const effectiveUser = user || userId
    if (!effectiveUser || !dataLoaded) return
    writeJsonCache(getResourceCacheKey(effectiveUser), {
      cachedAt: new Date().toISOString(),
      data: { templates, campaigns, leads, customContacts },
    })
  }, [campaigns, customContacts, dataLoaded, leads, templates, user])

  const createTemplateHandler = useCallback(async (data: Partial<Template>) => {
    const tempId = `temp-${Date.now()}`
    const optimistic = { ...data, id: tempId } as Template
    setTemplates(prev => [optimistic, ...prev])
    try {
      const created = await createTemplate(data)
      setTemplates(prev => prev.map(t => t.id === tempId ? created : t))
      return created
    } catch (err) {
      setTemplates(prev => prev.filter(t => t.id !== tempId))
      throw err
    }
  }, [])

  const updateTemplateHandler = useCallback(async (data: Partial<Template> & { id: string }) => {
    const prev = templates
    setTemplates(curr => curr.map(t => t.id === data.id ? { ...t, ...data } : t))
    try {
      const updated = await updateTemplate(data)
      setTemplates(curr => curr.map(t => t.id === updated.id ? updated : t))
      return updated
    } catch (err) {
      setTemplates(() => prev)
      throw err
    }
  }, [templates])

  const deleteTemplateHandler = useCallback(async (id: string) => {
    const prev = templates
    setTemplates(curr => curr.filter(t => t.id !== id))
    try {
      await deleteTemplate(id)
    } catch (err) {
      setTemplates(() => prev)
      throw err
    }
  }, [templates])

  const createCampaignHandler = useCallback(async (data: Partial<UiCampaign>) => {
    const tempId = `temp-${Date.now()}`
    const optimistic = { ...data, id: tempId, status: data.status || 'active' } as UiCampaign
    setCampaigns(prev => [optimistic, ...prev])
    try {
      const created = await createCampaign(data)
      setCampaigns(prev => prev.map(c => c.id === tempId ? created : c))
      return created
    } catch (err) {
      setCampaigns(prev => prev.filter(c => c.id !== tempId))
      throw err
    }
  }, [])

  const updateCampaignHandler = useCallback(async (data: Partial<UiCampaign> & { id: string }) => {
    const prev = campaigns
    setCampaigns(curr => curr.map(c => c.id === data.id ? { ...c, ...data } : c))
    try {
      const updated = await updateCampaign(data)
      setCampaigns(curr => curr.map(c => c.id === updated.id ? updated : c))
      return updated
    } catch (err) {
      setCampaigns(() => prev)
      throw err
    }
  }, [campaigns])

  const deleteCampaignHandler = useCallback(async (id: string) => {
    const prev = campaigns
    setCampaigns(curr => curr.filter(c => c.id !== id))
    try {
      await deleteCampaign(id)
    } catch (err) {
      setCampaigns(() => prev)
      throw err
    }
  }, [campaigns])

  const refreshLeads = useCallback(async () => {
    const res = await fetchLeads()
    setLeads(res?.items || [])
  }, [])

  const updateLeadHandler = useCallback(async (data: { id: string; status?: string; notes?: string | null }) => {
    const prev = leads
    setLeads(curr => curr.map(l => l.id === data.id
      ? { ...l, ...data, status: (data.status ?? l.status) as UserLead['status'] }
      : l
    ))
    try {
      const updated = await updateLead(data)
      setLeads(curr => curr.map(l => l.id === updated.id ? { ...l, ...updated } : l))
      return updated
    } catch (err) {
      setLeads(() => prev)
      throw err
    }
  }, [leads])

  const deleteLeadHandler = useCallback(async (id: string) => {
    const prev = leads
    setLeads(curr => curr.filter(l => l.id !== id))
    try {
      await deleteLead(id)
    } catch (err) {
      setLeads(() => prev)
      throw err
    }
  }, [leads])

  const createCustomContactHandler = useCallback(async (data: Partial<CustomContact>) => {
    const created = await createCustomContact(data)
    setCustomContacts(prev => [created, ...prev])
    return created
  }, [])

  const updateCustomContactHandler = useCallback(async (data: Partial<CustomContact> & { id: string }) => {
    const prev = customContacts
    setCustomContacts(curr => curr.map(c => c.id === data.id ? { ...c, ...data } : c))
    try {
      const updated = await updateCustomContact(data)
      setCustomContacts(curr => curr.map(c => c.id === updated.id ? { ...c, ...updated } : c))
      return updated
    } catch (err) {
      setCustomContacts(() => prev)
      throw err
    }
  }, [customContacts])

  const deleteCustomContactHandler = useCallback(async (id: string) => {
    const prev = customContacts
    setCustomContacts(curr => curr.filter(c => c.id !== id))
    try {
      await deleteCustomContact(id)
    } catch (err) {
      setCustomContacts(() => prev)
      throw err
    }
  }, [customContacts])

  return {
    campaigns,
    leads,
    customContacts,
    templates,
    dataLoaded,
    hasResourceCache,
    resourceFetchErrors,
    retryResources: () => setResourceLoadCount(n => n + 1),
    createCampaign: createCampaignHandler,
    updateCampaign: updateCampaignHandler,
    deleteCampaign: deleteCampaignHandler,
    refreshLeads,
    updateLead: updateLeadHandler,
    deleteLead: deleteLeadHandler,
    createCustomContact: createCustomContactHandler,
    updateCustomContact: updateCustomContactHandler,
    deleteCustomContact: deleteCustomContactHandler,
    createTemplate: createTemplateHandler,
    updateTemplate: updateTemplateHandler,
    deleteTemplate: deleteTemplateHandler,
  }
}
