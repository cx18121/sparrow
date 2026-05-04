export function createWorkspaceConfig({ user, templates = [], data = null }) {
  const defaultName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || ''
  const defaultTemplateId = templates[0]?.id || ''

  const baseConfig = {
    resumeText: '',
    resumeFileName: '',
    resumePath: '',
    resumeUploadedAt: '',
    senderName: defaultName,
    senderCompany: '',
    senderRole: '',
    signature: '',
    timeZone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    templateMode: 'existing',
    styleChoices: {},
    styleProfile: null,
    templateId: defaultTemplateId,
    customTemplate: {
      id: '',
      name: '',
      subject: '',
      body: '',
      isShared: false,
    },
    files: [] as Array<{ id: string; path: string; fileName: string; mimeType: string; size: number; uploadedAt: string }>,
    leadsPerGeneration: 25,
    sendingLimits: {
      dailyMax: 100,
      delaySeconds: 15,
    },
    apiKeys: {
      openai: '',
      claude: '',
      gemini: '',
      apollo: '',
      serper: '',
    },
  }

  const merged = {
    ...baseConfig,
    ...(data || {}),
    customTemplate: {
      ...baseConfig.customTemplate,
      ...(data?.customTemplate || {}),
    },
    styleChoices: {
      ...baseConfig.styleChoices,
      ...(data?.styleChoices || {}),
    },
    sendingLimits: {
      ...baseConfig.sendingLimits,
      ...(data?.sendingLimits || {}),
    },
    files: Array.isArray(data?.files) ? data.files : baseConfig.files,
    styleProfile: data?.styleProfile || baseConfig.styleProfile,
    apiKeys: {
      ...baseConfig.apiKeys,
      ...(data?.apiKeys || {}),
    },
  }

  const templateExists = templates.some(template => template.id === merged.templateId)

  return {
    ...merged,
    templateId: templateExists ? merged.templateId : defaultTemplateId,
  }
}
