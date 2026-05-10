# Templates default to verbatim with optional AI rewrite

Supersedes ADR-0003 as the default Template behavior. ADR-0003 still describes the opt-in AI rewrite path for `Template.verbatim = false`.

New Templates default to `verbatim = true`. In verbatim mode, Sparrow renders the subject and body exactly as authored after merge-tag substitution. Supported tags include contact/sender/company tags plus AI-derived tags such as `{{feature_line}}` and `{{fit_angle}}`. Claude is still used upstream to research and pick those AI-derived values, but it does not rewrite the authored body.

Users can turn off "Send this template verbatim" to opt into the AI-personalized skeleton path. In that mode, Sparrow substitutes merge tags first, then asks Claude to rewrite the body using the template as structure and intent.

## Rationale

Users who write a Template often expect their exact wording to survive. The product still benefits from per-company research through `{{feature_line}}` and `{{fit_angle}}`, but the default should not unexpectedly edit user-authored copy.

The AI rewrite path remains useful for users who want a looser skeleton and more per-recipient variation.

## Consequences

- `Template.verbatim` defaults to `true` in Prisma and in `server/routes/templates.ts`.
- `generateDraft` dispatches to `DraftInput.kind = "verbatim"` when the Template is marked verbatim.
- Verbatim rendering does not call Claude in `generateEmailDraft`; it only substitutes merge tags and drops paragraphs anchored on missing AI-only tags.
- `DraftInput.kind = "template"` remains the opt-in AI rewrite branch.
