export function createWorkspaceConfig({ user, templates = [], data = null }) {
  const defaultName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || ''
  const defaultTemplateId = templates[0]?.id || ''

  const baseConfig = {
    resumeText: '',
    resumeFileName: '',
    resumePath: '',
    senderName: defaultName,
    senderCompany: '',
    senderRole: '',
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
    leadsPerGeneration: 50,
    sendingLimits: {
      dailyMax: 200,
      delaySeconds: 30,
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
