# Template skeletons can be personalized by AI

Status: Superseded by ADR-0004.

This ADR superseded ADR-0002 when all Templates were treated as reusable skeletons. The current implementation keeps this path only when `Template.verbatim = false`.

In AI-personalized Template mode, a Template body may contain merge tags such as `{{first_name}}`, `{{company}}`, and `{{sender_name}}`; those tags are substituted first, then Claude rewrites the body per recipient using the Lead's Company context, Contact context, sender context, and any AI research outputs.

This is the right trade-off because users need repeatable structure without giving up per-recipient relevance. A verbatim Template can preserve exact wording, but it also blocks the core value of the product: using Company context to create a Draft that sounds specific to the recipient.

The subject remains template-driven. AI personalizes the body only.

## Consequences

`generateEmailDraft` keeps `kind: "template"` as a distinct mode, but that mode calls the Anthropic adapter with the substituted Template body as a skeleton. Tests for Template mode should assert that the skeleton and Company context are present in the prompt, not that Anthropic is bypassed.
