// Tiptap custom node that renders {{merge_tags}} as atomic pill chips in the
// editor. On-disk storage stays as `{{tag}}` text inside the body HTML — server
// code (substituteVariables in server/lib/ai/generate-email.ts) doesn't change.
//
// Round-trip:
//   load  → tagsToSpans(content)  → editor parses spans as MergeTag nodes
//   save  → editor.getHTML() → spansToTags(...) → caller stores `{{tag}}` text
//
// Why atomic Node and not Decoration: clicking a pill and pressing Backspace
// should delete the whole tag, not one character. Decoration is visual-only
// and the underlying text remains 13 characters of "{{first_name}}".

import { Node, mergeAttributes } from '@tiptap/core'

// Catalog the renderer should produce a pill for. Anything outside this list
// passes through untouched as plain text, so a typo'd {{xyz}} doesn't silently
// become a pill that nothing will substitute.
const KNOWN_TAGS = new Set([
  'first_name',
  'last_name',
  'company',
  'company_name',
  'role',
  'sender_name',
  'feature_line',
  'fit_angle',
])

export const MergeTag = Node.create({
  name: 'mergeTag',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: {
        default: 'first_name',
        parseHTML: el => (el as HTMLElement).getAttribute('data-merge-tag') ?? 'first_name',
        renderHTML: attrs => ({ 'data-merge-tag': attrs.name }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-merge-tag]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'merge-tag-pill' }),
      node.attrs.name,
    ]
  },
})

// Convert `{{tag}}` text occurrences inside an HTML string into MergeTag spans
// that Tiptap will parse as mergeTag nodes on editor load. Unknown tags are
// left alone (typos shouldn't become silently atomic).
export function tagsToSpans(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(/\{\{([a-z_]+)\}\}/g, (full, name: string) =>
    KNOWN_TAGS.has(name)
      ? `<span data-merge-tag="${name}" class="merge-tag-pill">${name}</span>`
      : full,
  )
}

// Inverse: collapse the MergeTag spans Tiptap emits back to `{{tag}}` text for
// storage. Tolerates whitespace and attribute order — Tiptap and DOMPurify
// each have opinions about serialization, so we accept either order of
// data-merge-tag and class attributes.
export function spansToTags(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(
    /<span\b[^>]*\bdata-merge-tag="([a-z_]+)"[^>]*>[\s\S]*?<\/span>/gi,
    (_, name: string) => `{{${name}}}`,
  )
}
