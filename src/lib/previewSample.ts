// Shared sample identity used by every UI surface that previews a template
// before a real recipient is selected (onboarding Step 2, campaign wizard,
// templates editor). One source of truth so the surfaces don't drift.
//
// Mirrors the recipient baked into server/routes/preview-fit-angle.ts —
// keeping the same Anthropic / Dario context across the live pickFitAngle
// preview and the static merge-tag previews.
export const PREVIEW_SAMPLE = {
  first_name: 'Dario',
  last_name: 'Amodei',
  company: 'Anthropic',
  role: 'CEO',
  sender_name: 'Your Name',
  feature_line: 'claude code agentic coding',
  fit_angle: 'your background',
} as const

// Used by surfaces that run the real pickFitAngle preview but need a
// fallback when the model returns nothing or hasn't responded yet.
// feature_line gets a real dossier surface; fit_angle stays domain-neutral
// so the rendered paragraph reads naturally regardless of the user's resume.
export const PREVIEW_FALLBACK = {
  feature_line: PREVIEW_SAMPLE.feature_line,
  fit_angle: PREVIEW_SAMPLE.fit_angle as string | null,
} as const
