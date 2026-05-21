// Shared template-preview helpers. Surfaces that render a template before
// a real recipient is known (create-campaign wizard, workspace settings tab,
// onboarding step 2, templates editor) all need the same two operations:
//   1. Substitute {{merge_tags}} with PREVIEW_SAMPLE values.
//   2. Convert TipTap HTML to readable plaintext that a preview pane can
//      render with `whitespace-pre-line`.
//
// Keeping them in one module prevents drift — if a new tag is added to
// PREVIEW_SAMPLE, only this file needs updating for the previews on every
// surface to reflect it.

import { PREVIEW_SAMPLE } from './previewSample'

export function fillTemplateTags(content: string): string {
  if (!content) return ''
  return content
    .replace(/\{\{first_name\}\}/g, PREVIEW_SAMPLE.first_name)
    .replace(/\{\{firstName\}\}/g, PREVIEW_SAMPLE.first_name)
    .replace(/\{\{last_name\}\}/g, PREVIEW_SAMPLE.last_name)
    .replace(/\{\{lastName\}\}/g, PREVIEW_SAMPLE.last_name)
    .replace(/\{\{company\}\}/g, PREVIEW_SAMPLE.company)
    .replace(/\{\{company_name\}\}/g, PREVIEW_SAMPLE.company)
    .replace(/\{\{companyName\}\}/g, PREVIEW_SAMPLE.company)
    .replace(/\{\{role\}\}/g, PREVIEW_SAMPLE.role)
    .replace(/\{\{sender_name\}\}/g, PREVIEW_SAMPLE.sender_name)
    .replace(/\{\{senderName\}\}/g, PREVIEW_SAMPLE.sender_name)
    .replace(/\{\{feature_line\}\}/g, PREVIEW_SAMPLE.feature_line)
    .replace(/\{\{featureLine\}\}/g, PREVIEW_SAMPLE.feature_line)
    .replace(/\{\{fit_angle\}\}/g, PREVIEW_SAMPLE.fit_angle)
    .replace(/\{\{fitAngle\}\}/g, PREVIEW_SAMPLE.fit_angle)
    .replace(/\{\{trigger_line\}\}/g, PREVIEW_SAMPLE.trigger_line)
    .replace(/\{\{triggerLine\}\}/g, PREVIEW_SAMPLE.trigger_line)
    .replace(/\{\{proof_of_motion\}\}/g, PREVIEW_SAMPLE.proof_of_motion)
    .replace(/\{\{proofOfMotion\}\}/g, PREVIEW_SAMPLE.proof_of_motion)
    .replace(/\{\{inflection_line\}\}/g, PREVIEW_SAMPLE.inflection_line)
    .replace(/\{\{inflectionLine\}\}/g, PREVIEW_SAMPLE.inflection_line)
    .replace(/\{\{system_built\}\}/g, PREVIEW_SAMPLE.system_built)
    .replace(/\{\{systemBuilt\}\}/g, PREVIEW_SAMPLE.system_built)
}

// Strip HTML to readable plaintext for a preview pane. Keeps paragraph
// breaks via \n\n so a container with `whitespace-pre-line` renders the
// email as it would arrive in an inbox.
export function stripPreviewHtml(content: string): string {
  if (!content) return ''
  if (!content.includes('<')) return content
  if (typeof window !== 'undefined' && window.DOMParser) {
    const doc = new DOMParser().parseFromString(content, 'text/html')
    doc.body.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
    doc.body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li').forEach(node => {
      node.appendChild(doc.createTextNode('\n\n'))
    })
    return (doc.body.textContent || '')
      .replace(/ /g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  return content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
