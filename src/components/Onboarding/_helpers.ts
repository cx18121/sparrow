// Onboarding shared helpers. Lives here (not inline in OnboardingScreen)
// because stripHtml is needed both by the orchestrator's initial-form
// builder and by TemplateStep's preview render.

export function stripHtml(content: string | null | undefined): string {
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
