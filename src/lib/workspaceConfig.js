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
    templateId: defaultTemplateId,
    customTemplate: {
      id: '',
      name: '',
      subject: '',
      body: '',
      isShared: false,
    },
    leadsPerGeneration: 50,
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
