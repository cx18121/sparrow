# Template body is used verbatim, not fed to the AI

Status: Superseded by ADR-0003.

When a Campaign has a Template attached, the template body must be delivered verbatim to the recipient with only `{{variable}}` placeholders substituted — the AI must not rewrite or "fill" it. The current implementation incorrectly passes the template to Claude with a "Fill the template" instruction, which means Claude rewrites the content unpredictably.

The intended behaviour: if `userTemplate` is provided, bypass AI body generation entirely and perform direct variable substitution only. AI generation (using `BUILT_IN_DEFAULT_TEMPLATE`) runs only when no Template is attached.

This is the right trade-off because users who write a Template expect their exact wording to reach the recipient. AI rewriting defeats the purpose of having a Template at all.

## Consequences

`generateEmailDraft` needs a code path that short-circuits AI generation when `userTemplate` is non-null, returning the substituted body directly.
