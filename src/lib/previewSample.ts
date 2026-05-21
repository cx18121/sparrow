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
  // Eng / product personalization (CompanyDossier).
  feature_line: 'claude code agentic coding',
  fit_angle: 'your background',
  // GTM personalization (GtmDossier). trigger_line is a recent company
  // event; proof_of_motion is candidate-side. Candidate-side values stay
  // domain-neutral so the rendered paragraph reads naturally for any
  // user's resume.
  trigger_line: "Anthropic's $4B Amazon round",
  proof_of_motion: 'your background',
  // Ops personalization (OpsDossier). Same shape — inflection_line is
  // company signal, system_built is candidate-side.
  inflection_line: "Anthropic's hiring push across go-to-market",
  system_built: 'your background',
} as const

// Used by surfaces that run the real pickFitAngle preview but need a
// fallback when the model returns nothing or hasn't responded yet.
// Company-side values mirror PREVIEW_SAMPLE; candidate-side values stay
// domain-neutral so the rendered paragraph reads naturally regardless of
// the user's resume.
export const PREVIEW_FALLBACK = {
  feature_line: PREVIEW_SAMPLE.feature_line,
  fit_angle: PREVIEW_SAMPLE.fit_angle as string | null,
  trigger_line: PREVIEW_SAMPLE.trigger_line as string | null,
  proof_of_motion: PREVIEW_SAMPLE.proof_of_motion as string | null,
  inflection_line: PREVIEW_SAMPLE.inflection_line as string | null,
  system_built: PREVIEW_SAMPLE.system_built as string | null,
} as const
