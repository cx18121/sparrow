import {
  DEFAULT_ROLE_FAMILY,
  normalizeRoleFamily,
  type RoleFamily,
} from '../types/roleFamilies'

// Pre-filled starter templates for fresh onboarding sessions, per role
// family. Each uses merge tags that match its role's picker output so
// the Step 2 preview renders a real-looking email immediately — minimum
// friction: user can either edit or just hit Continue.
//
// Per ADR-0005 the engineering pipeline produces {{feature_line}} +
// {{fit_angle}}; the GTM pipeline produces {{trigger_line}} +
// {{proof_of_motion}}. Mismatched tags would substitute to empty
// strings and trigger dropEmptyTagParagraphs, leaving the template
// gutted on first use. Product shares the eng pipeline so it shares
// the eng template; operations stays on the eng template too until
// slice 3 ships an ops picker.
//
// Existing users with a saved customTemplate keep theirs because the
// data merge below overrides the default with whatever they last saved
// (including an explicit empty body).
const ENG_DEFAULT_TEMPLATE = {
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
    'Best,',
    '{{sender_name}}',
  ].join('\n'),
  attachmentIds: [] as string[],
  isShared: false,
};

const GTM_DEFAULT_TEMPLATE = {
  id: '',
  name: 'GTM intro',
  subject: 'Quick note on {{company}}',
  body: [
    'Hi {{first_name}},',
    '',
    'Caught the news on {{trigger_line}} — that\'s exactly the kind of motion I want to help build.',
    '',
    'For context, {{proof_of_motion}} is the closest analog to what your team is heading into.',
    '',
    'Worth a 15-min call this week?',
    '',
    'Best,',
    '{{sender_name}}',
  ].join('\n'),
  attachmentIds: [] as string[],
  isShared: false,
};

const OPS_DEFAULT_TEMPLATE = {
  id: '',
  name: 'Ops intro',
  subject: 'Quick thought on {{company}}',
  body: [
    'Hi {{first_name}},',
    '',
    'Noticed {{inflection_line}} — that\'s the inflection where operational systems start to matter.',
    '',
    'For context, {{system_built}} is the closest analog to what your team is heading into.',
    '',
    'Worth a 15-min call this week?',
    '',
    'Best,',
    '{{sender_name}}',
  ].join('\n'),
  attachmentIds: [] as string[],
  isShared: false,
};

const DEFAULT_CUSTOM_TEMPLATE_BY_ROLE: Record<RoleFamily, typeof ENG_DEFAULT_TEMPLATE> = {
  engineering: ENG_DEFAULT_TEMPLATE,
  product: ENG_DEFAULT_TEMPLATE,
  gtm: GTM_DEFAULT_TEMPLATE,
  operations: OPS_DEFAULT_TEMPLATE,
};

function defaultCustomTemplateFor(role: RoleFamily): typeof ENG_DEFAULT_TEMPLATE {
  return DEFAULT_CUSTOM_TEMPLATE_BY_ROLE[role] ?? ENG_DEFAULT_TEMPLATE;
}

export type WorkspaceFile = {
  id: string;
  path?: string;
  fileName: string;
  mimeType?: string | null;
  size?: number | null;
  uploadedAt?: string | null;
};

export type AttachmentFile = WorkspaceFile & {
  source?: 'resume' | 'library';
};

// Bounds for the per-campaign lead batch size. The number ends up driving how
// many companies one campaign run will ingest at once, so it needs a ceiling to
// avoid runaway Apollo cost / draft-generation latency. Kept here because it
// pairs with the leadsPerGeneration default below and lets the UI surface a
// single source of truth in labels, hints, and validation toasts.
export const LEAD_BATCH_MIN = 1;
export const LEAD_BATCH_MAX = 50;

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeSendingLimits(value: any, bounds = { maxDaily: 500 }) {
  const daily = finiteNumber(value?.dailyMax);
  const delay = finiteNumber(value?.delaySeconds);
  return {
    dailyMax:
      daily == null
        ? 250
        : Math.min(bounds.maxDaily, Math.max(1, Math.round(daily))),
    delaySeconds:
      delay == null ? 15 : Math.min(3600, Math.max(15, Math.round(delay))),
  };
}

export function getAttachmentLibrary(workspaceConfig: any): AttachmentFile[] {
  const files = Array.isArray(workspaceConfig?.files)
    ? workspaceConfig.files
    : [];
  const resume =
    workspaceConfig?.resumePath && workspaceConfig?.resumeFileName
      ? [
          {
            id: 'resume',
            path: workspaceConfig.resumePath,
            fileName: workspaceConfig.resumeFileName,
            mimeType: workspaceConfig.resumeFileName
              .toLowerCase()
              .endsWith('.pdf')
              ? 'application/pdf'
              : undefined,
            size: null,
            uploadedAt: workspaceConfig.resumeUploadedAt || null,
            source: 'resume' as const,
          },
        ]
      : [];
  return [
    ...resume,
    ...files.map((file: AttachmentFile) => ({
      ...file,
      source: 'library' as const,
    })),
  ];
}

export function createWorkspaceConfig({ user, templates = [], data = null }) {
  const defaultName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.preferred_username ||
    user?.email?.split('@')[0] ||
    '';
  // Library templates are read-only and rejected by draft-generation. They
  // must not become the workspace default; users have to clone them first.
  const personalTemplates = templates.filter((t: any) => t?.userId !== '__library__');
  const defaultTemplateId = personalTemplates[0]?.id || '';

  // Resolve target role from saved data before building the base config
  // so the per-family default customTemplate matches the user's role.
  // Fresh users get DEFAULT_ROLE_FAMILY (engineering) and the eng default
  // template. Users with saved targetRole='gtm' get the GTM default
  // template — the merge tags match the GTM picker's output, so
  // dropEmptyTagParagraphs doesn't gut the body on first use.
  const resolvedTargetRole = normalizeRoleFamily(
    data?.targetRole,
    { fallback: DEFAULT_ROLE_FAMILY },
  ) as RoleFamily;

  const baseConfig = {
    resumeText: '',
    resumeExtractedText: '',
    resumeFileName: '',
    resumePath: '',
    resumeUploadedAt: '',
    senderName: defaultName,
    // Default to 'custom' for fresh users (no existing templates). Without
    // this, syncOnboardingTemplate in App.tsx silently drops the pre-filled
    // customTemplate because its persistence path is gated on
    // `data.templateMode === 'custom'` — and the user never explicitly flips
    // this since the UI forces writing mode whenever templates is empty.
    // Returning users with saved templates inherit their previously chosen
    // mode through the data merge below.
    templateMode: defaultTemplateId ? 'existing' : 'custom',
    templateId: defaultTemplateId,
    customTemplate: { ...defaultCustomTemplateFor(resolvedTargetRole) },
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
      dailyMax: 250,
      delaySeconds: 15,
    },
    // Default role family for new campaigns. Onboarding overrides this with
    // the user's actual selection; existing users with no targetRole saved
    // get DEFAULT_ROLE_FAMILY ('engineering') preserving the pre-refactor
    // TARGET_TITLES behavior. resolvedTargetRole above mirrors this so the
    // per-family default customTemplate stays in sync with the role.
    targetRole: resolvedTargetRole,
  };

  const merged = {
    ...baseConfig,
    ...(data || {}),
    customTemplate: {
      ...baseConfig.customTemplate,
      ...(data?.customTemplate || {}),
    },
    sendingLimits: normalizeSendingLimits(
      data?.sendingLimits || baseConfig.sendingLimits
    ),
    files: Array.isArray(data?.files) ? data.files : baseConfig.files,
    targetRole: normalizeRoleFamily(
      data?.targetRole,
      { fallback: baseConfig.targetRole }
    ),
  };

  const templateExists = personalTemplates.some(
    (template: any) => template.id === merged.templateId
  );

  return {
    ...merged,
    templateId: templateExists ? merged.templateId : defaultTemplateId,
  };
}

export function profileResumeTextFromWorkspace(workspaceConfig: any): string {
  const typed = workspaceConfig?.resumeText?.trim?.() || '';
  const extracted = workspaceConfig?.resumeExtractedText?.trim?.() || '';
  return [typed, extracted].filter(Boolean).join('\n\n');
}
