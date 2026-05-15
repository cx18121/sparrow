# e2e test conventions

The e2e suite drifted during a UI reshape on 2026-05-15: eight tests failed
because they were asserting on display copy (`text=/Send rate/i`,
`text=/Daily send limit/i`, heading text on the Settings page, etc.) rather
than the structural behavior beneath the copy. Re-pinning new copy fixes
the symptom but not the root cause; the next rename will break the tests
again.

These conventions exist to prevent that.

## Rule of thumb

> **Pin behavior, not copy.** A test that breaks when the UI is rephrased
> wasn't testing behavior — it was testing today's wording. Rewrite it.

When you have to choose a selector, walk this list top-to-bottom and use the
first one that works:

1. **Network interception** (`page.route` + `postDataJSON()`) — assert what
   the server received. The strongest behavioral contract.
2. **URL match** (`expect(page).toHaveURL(...)`) — proves navigation
   happened, regardless of what's on the page.
3. **Role + name** (`getByRole('button', { name: ... })`) — semantic, what
   a screen reader uses. Survives most styling/copy changes.
4. **Label association** (`getByLabel(/Sender name/i)`) — stable as long as
   the input has a `<label htmlFor>` or `aria-label`.
5. **`aria-current`, `aria-selected`, `role="alert"`, `role="status"`** —
   ARIA state, structural by design. Banner/toast roles already exist in
   our `Banner` (status) and `Toast` (alert/status by type) components.
6. **Test data the test itself supplied** (`text=Avery Kim`, where
   "Avery Kim" was passed in by the test seed) — fine. The point of the
   assertion is *that the test's data reached the screen*.
7. **`text=/copy/`** — only for assertions where the copy *is* the contract
   (e.g. confirmation toasts, error banners users will Google for).
   Otherwise, climb the list above.

## Anti-patterns

- ❌ `text=/Send rate/i` to find the Sending tab — section heading copy.
  Use `getByRole('tab', { name: /Sending/ })` or `getByLabel(/Lead batch size/i)`.
- ❌ `text=/Name your campaign/i` to find wizard step 1 — heading copy.
  Use the active step button: `page.locator('button[aria-current="step"]')`.
- ❌ `locator('label', { hasText: 'Daily send limit' })` — couples to label
  text *and* DOM nesting. Add `htmlFor`+`id` to the input and use
  `getByLabel(...)`.
- ❌ Asserting `body === 'Updated body'` when the editor sends rich-text
  HTML. The contract is "the user's input reaches the server intact",
  not "the wire format is plain text". Use `.toContain('Updated body')`
  or strip-and-compare.

## When the component lacks a stable selector

Add one. In priority order:

1. Promote the implicit role with `aria-label` (e.g.,
   `<section aria-label="Campaign settings">`).
2. Give buttons their `role="tab"` / `role="tablist"` / `aria-selected`
   ARIA state. Most of our tabs already do this.
3. Last resort: `data-testid`. Reserve for cases where there's no
   semantic anchor (rare in this codebase).

## What the suite already does well

- **`page.route`-based payload assertions** (~50 occurrences across the
  suite). These survive every UI change and pin the actual contract.
- **`getByRole` for buttons, tabs, headings** (~135 occurrences). Most
  passing tests already use these.
- **`signInDemo` + `createTestTemplate` + `createTestCampaign`** seed
  helpers, so data assertions are about *flow*, not about static UI copy.

## What broke and why

| Test | Was checking | Fix |
|---|---|---|
| `gmail-connect:110` | `text=/Send rate/i` | `getByLabel(/Lead batch size/i)` — anchors the Sending tab by an input that exists in it. |
| `home:36` | three KPI labels by text | Two KPIs by text (still copy-coupled, but matches the data being asserted on the cells themselves). |
| `mobile-navigation:18` | `heading: /Settings/i` | URL match (already there) + `getByRole('tab', { name: /Profile/ })` for structure. |
| `drafts-ux:96` | `body === 'Updated body'` | `body.toContain('Updated body')` — editor now wraps in HTML. |
| `onboarding-gmail` | `senderRole`/`senderCompany` fields | Deleted — those fields no longer exist. |
| `settings-workspace-ux:67` | daily send limit clamp | Deleted — the feature was retired. |
