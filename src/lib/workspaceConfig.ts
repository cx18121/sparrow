// Pre-filled starter template for fresh onboarding sessions. Uses the
// high-signal merge tags ({{first_name}}, {{company}}, {{feature_line}},
// {{fit_angle}}, {{sender_name}}) so the Step 2 preview renders a real-
// looking email immediately — minimum friction: user can either edit or
// just hit Continue. Existing users with a saved customTemplate keep
// theirs because the data merge below overrides this with whatever they
// last saved (including an explicit empty body).
const DEFAULT_CUSTOM_TEMPLATE = {
  id: '',
  name: 'Founder intro',
  subject: 'Interested in learning about {{company}}',
  body: [
    'Hi {{first_name}},',
    '',
    'Saw {{company}} just shipped {{feature_line}}, which is exactly the kind of work I want to be hands-on with.',
    '',
    'For context, {{fit_angle}} feels like a natural stepping stone toward what your team is building.',
    '',
    'Would a 15-min call this week make sense?',
    '',
    'Best',
    '{{sender_name}}',
  ].join('\n'),
  attachmentIds: [] as string[],
  isShared: false,
};

export function createWorkspaceConfig({ user, templates = [], data = null }) {
  const defaultName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.preferred_username ||
    user?.email?.split('@')[0] ||
    '';
  const defaultTemplateId = templates[0]?.id || '';

  const baseConfig = {
    resumeText: '',
    resumeFileName: '',
    resumePath: '',
    resumeUploadedAt: '',
    senderName: defaultName,
    senderCompany: '',
    senderRole: '',
    // Default to 'custom' for fresh users (no existing templates). Without
    // this, syncOnboardingTemplate in App.tsx silently drops the pre-filled
    // customTemplate because its persistence path is gated on
    // `data.templateMode === 'custom'` — and the user never explicitly flips
    // this since the UI forces writing mode whenever templates is empty.
    // Returning users with saved templates inherit their previously chosen
    // mode through the data merge below.
    templateMode: defaultTemplateId ? 'existing' : 'custom',
    templateId: defaultTemplateId,
    customTemplate: { ...DEFAULT_CUSTOM_TEMPLATE },
    files: [] as Array<{
      id: string;
      path: string;
      fileName: string;
      mimeType: string;
      size: number;
      uploadedAt: string;
    }>,
    leadsPerGeneration: 25,
    sendingLimits: {
      dailyMax: 100,
      delaySeconds: 15,
    },
  };

  const merged = {
    ...baseConfig,
    ...(data || {}),
    customTemplate: {
      ...baseConfig.customTemplate,
      ...(data?.customTemplate || {}),
    },
    sendingLimits: {
      ...baseConfig.sendingLimits,
      ...(data?.sendingLimits || {}),
    },
    files: Array.isArray(data?.files) ? data.files : baseConfig.files,
  };

  const templateExists = templates.some(
    (template) => template.id === merged.templateId
  );

  return {
    ...merged,
    templateId: templateExists ? merged.templateId : defaultTemplateId,
  };
}
