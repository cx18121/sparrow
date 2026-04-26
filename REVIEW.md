# ColdFlow — Full Codebase Bug & Issue Audit

**Reviewed:** 2026-04-26  
**Scope:** All files under `api/`, `src/`, `prisma/schema.prisma`, `supabase/schema.sql`, `package.json`, `vite.config.js`, `vercel.json`  
**Total findings:** 34

---

## Severity legend

| Level | Meaning |
|-------|---------|
| **P0** | Crash / active security vulnerability |
| **P1** | Data loss, broken core feature, auth bypass |
| **P2** | Degraded UX, silent wrong behavior |
| **P3** | Minor quality / code smell |

---

## P0 — Crash / Security

---

### P0-1: `x-user-id` header accepted as valid auth in production (`api/_lib/user.ts`)

**File:** `api/_lib/user.ts:6-11`  
**What:** `getUserId()` accepts any string in the `x-user-id` header as the authenticated user ID — no signature or verification. The comment says "When auth lands, replace with a Supabase JWT verifier," but this function is still imported and used in production by `api/companies.ts` and `api/contacts.ts`.

```ts
// api/_lib/user.ts — still exported and available
export function getUserId(req: VercelRequest): string | null {
  const header = req.headers["x-user-id"];
  if (typeof header === "string" && header.length > 0) return header;
  ...
}
```

`api/companies.ts` and `api/contacts.ts` **do not authenticate at all** — they call neither `getUserId` nor `getUserIdFromRequest`. Any anonymous caller can list all companies and contacts in the database.

**Fix:** Add auth to `api/companies.ts` and `api/contacts.ts` the same way the other routes do:
```ts
const userId = await getUserIdFromRequest(req);
if (!userId) return res.status(401).json({ error: "Unauthorized" });
```
Then delete or clearly gate `api/_lib/user.ts` so it cannot be used in production code paths.

---

### P0-2: `x-user-id` bypass is never disabled — any attacker can impersonate any user (`api/_lib/supabaseAdmin.ts`)

**File:** `api/_lib/supabaseAdmin.ts:32-35`  
**What:** `getUserIdFromRequest` falls through to accept `x-user-id` as a valid user ID when no `Authorization` header is present, with no environment check:

```ts
// No guard against NODE_ENV=production
const header = req.headers["x-user-id"];
if (typeof header === "string" && header.length > 0) return header;
```

In production, a caller who sends `x-user-id: <victim-uuid>` bypasses Supabase JWT auth entirely and can access any user's leads, emails, campaigns, templates, and sequences. All CRUD routes (`leads.ts`, `emails.ts`, `campaigns.ts`, `templates.ts`, `sequences.ts`, `profile.ts`) use this function.

**Fix:** Gate the fallback behind a strict environment check:
```ts
if (process.env.NODE_ENV !== "production" && process.env.ALLOW_X_USER_ID === "1") {
  const header = req.headers["x-user-id"];
  if (typeof header === "string" && header.length > 0) return header;
}
```

---

### P0-3: `revealContact` in `apollo-search.ts` calls `revealAndSaveContact` with `personId` for both `domain` and `personId` arguments — data saved to wrong contact record

**File:** `api/apollo-search.ts:48`  
**What:**
```ts
// domain = personId (BUG)
const revealed = await revealAndSaveContact(personId, personId, apiKey);
```

`revealAndSaveContact`'s first parameter is `domain` (a string used to look up the company). Passing `personId` as the domain means the Apollo match request receives a garbage domain, will likely return `null`, and the contact is never saved. The function signature is:
```ts
export async function revealAndSaveContact(
  domain: string,   // <-- should be company domain
  personId: string,
  apiKey: string
)
```

**Fix:**
```ts
// The caller needs to pass the real company domain. The PUT handler
// should receive it in the request body alongside personId.
const { personId, domain } = req.body ?? {};
if (!personId) throw new HttpError(400, "personId is required");
const revealed = await revealAndSaveContact(domain ?? personId, personId, apiKey);
```

---

### P0-4: `DraftsTab` renders user-controlled email body with `dangerouslySetInnerHTML` — stored XSS vector (`src/components/Drafts/DraftsTab.jsx`)

**File:** `src/components/Drafts/DraftsTab.jsx:394-396`  
**What:**
```jsx
<div
  className="text-sm text-dark"
  dangerouslySetInnerHTML={{ __html: textToHtml(preview.body) }}
/>
```

`preview.body` is an email body fetched from the database. If a malicious AI-generated response or a tampered API payload contains `<script>` or event-handler tags, this renders them directly in the page, executing arbitrary JS. The `textToHtml` function does **not** sanitize — it only converts newlines to `<br>` and `<p>` tags, and explicitly passes through existing HTML unchanged (`if (text.includes('<')) return text`).

**Fix:** Sanitize before rendering:
```ts
import DOMPurify from 'dompurify'
// ...
dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(textToHtml(preview.body)) }}
```

---

### P0-5: Template preview in `TemplatesTab` renders unsanitized HTML — stored XSS (`src/components/Templates/TemplatesTab.jsx`)

**File:** `src/components/Templates/TemplatesTab.jsx:332-334`  
**What:**
```jsx
<div
  className="prose prose-sm max-w-none p-6 text-dark"
  dangerouslySetInnerHTML={{ __html: fillVariables(...) }}
/>
```

Template bodies are stored in PostgreSQL and rendered here without sanitization. Any user who saves a template containing `<img onerror="...">` or `<script>` gets XSS on their own page (self-XSS), or, since `isShared: true` templates are readable by **all** users (`templates.ts:23-28`), a malicious shared template can XSS every user.

**Fix:** Apply `DOMPurify.sanitize()` around `fillVariables(...)` output before passing to `dangerouslySetInnerHTML`.

---

### P0-6: `supabase/schema.sql` stores SMTP password in plaintext (`supabase/schema.sql`)

**File:** `supabase/schema.sql:156`  
**What:**
```sql
smtp_password   text, -- store encrypted in production!
```

The comment acknowledges this but the column is plaintext. Any Supabase Studio access or data leak exposes all users' SMTP passwords. The `SettingsPage` SMTP form also currently saves state only in React (not persisted), but if this ever gets wired up, it will hit this column.

**Fix:** Encrypt SMTP passwords server-side before storage using the same `encrypt()`/`decrypt()` pattern already in place for Claude API keys, or use Supabase Vault.

---

## P1 — Broken Feature / Data Loss

---

### P1-1: `api/companies.ts` and `api/contacts.ts` have no authentication — all company/contact data is publicly readable

**File:** `api/companies.ts:4`, `api/contacts.ts:4`  
**What:** Neither handler calls `getUserIdFromRequest` or any other auth check. Every GET request returns data regardless of whether a session exists. Combined with P0-1, this means the entire company/contact catalogue (thousands of rows) is readable by unauthenticated clients.

**Fix:** Add the standard auth guard:
```ts
const userId = await getUserIdFromRequest(req);
if (!userId) return res.status(401).json({ error: "Unauthorized" });
```

---

### P1-2: `emails.ts` — `update()` crashes with a runtime `TypeError` when `existing.userLead` is `null`

**File:** `api/emails.ts:90`  
**What:**
```ts
const existing = await prisma.email.findUnique({
  where: { id },
  include: { userLead: { select: { userId: true } } },
});
if (!existing || existing.userLead.userId !== userId) {  // ← crash if userLead deleted
```

If the parent `UserLead` row was deleted after the email was created (e.g., lead deleted from ContactsTab), `existing.userLead` is `null` and `.userId` throws `TypeError: Cannot read properties of null`. The response is an unhandled 500 exposing the stack trace.

**Fix:**
```ts
if (!existing || !existing.userLead || existing.userLead.userId !== userId) {
  throw new HttpError(404, "Email not found");
}
```

---

### P1-3: `ContactsTab` double-saves a draft — `generateEmail` already saves one, then `saveDraft` saves another

**File:** `src/components/Contacts/ContactsTab.jsx:101-117`, `api/emails/generate.ts:143-165`  
**What:** `api/emails/generate.ts` already upserts the generated email to the `emails` table (lines 143–165) and returns `emailId`. However, `ContactsTab.saveDraft()` calls `createEmail()` unconditionally after generation succeeds, creating a second duplicate draft row with the same content.

**Fix:** In `ContactsTab.saveDraft()`, skip the `createEmail` call if the `emailId` returned from `generateEmail` is non-null:
```js
const res = await generateEmail({ ... })
setGeneratedSubject(res.subject || '')
setGeneratedBody(res.body || '')
// res.emailId is already saved server-side — no need to createEmail again
```
Remove the standalone `saveDraft` that calls `createEmail`, or only call it when `res.emailId` is null.

---

### P1-4: Onboarding `useEffect` fires `onSaveDraft` on every render including initial mount, overwriting server-synced config

**File:** `src/components/Onboarding/OnboardingScreen.jsx:461-463`  
**What:**
```jsx
useEffect(() => {
  onSaveDraft?.(form)
}, [form, onSaveDraft])
```

`onSaveDraft` is `saveOnboardingDraft` which calls `localStorage.setItem` and `setWorkspaceConfig`. On initial mount it immediately fires with the locally-constructed `form`, overwriting any server-synced profile that `AppShell` just fetched in its concurrent `fetchProfile()` call. This creates a race: if the server profile resolves after the onboarding effect runs, it wins and is correct; if onboarding mounts first, the local defaults stomp the server data.

**Fix:** Skip the effect on initial mount:
```jsx
const mounted = useRef(false)
useEffect(() => {
  if (!mounted.current) { mounted.current = true; return }
  onSaveDraft?.(form)
}, [form, onSaveDraft])
```

---

### P1-5: `sequences.ts` `update()` — transaction returns `null` if `tx.sequence.findUnique` fails, causing a 200 with `null` body

**File:** `api/sequences.ts:88-94`  
**What:**
```ts
return tx.sequence.findUnique({
  where: { id: id as string },
  include: { steps: { orderBy: { order: "asc" } } },
});
```

`findUnique` returns `null` when no row matches. The outer handler does `res.status(200).json(sequence)` where `sequence` is the return value of the transaction — which can be `null`. The client gets `HTTP 200 null`.

**Fix:**
```ts
const updated = await tx.sequence.findUnique({ ... });
if (!updated) throw new Error("Sequence disappeared during update");
return updated;
```

---

### P1-6: `CampaignsTab` crashes on `.toLowerCase()` when campaign `subject` is `null`

**File:** `src/components/Campaigns/CampaignsTab.jsx:32-34`  
**What:**
```js
const filtered = campaigns.filter(c =>
  c.name.toLowerCase().includes(search.toLowerCase()) ||
  c.subject.toLowerCase().includes(search.toLowerCase())  // ← crash when subject is null
)
```

`subject` is nullable in the schema and can be `null` in the database. When a campaign has no subject and the user types in the search box, this throws `TypeError: Cannot read properties of null (reading 'toLowerCase')`, crashing the Campaigns tab.

**Fix:**
```js
(c.subject || '').toLowerCase().includes(search.toLowerCase())
```

---

### P1-7: `leads.ts` `create()` — race condition between `findFirst` check and `create` allows duplicate leads under concurrent requests

**File:** `api/leads.ts:101-119`  
**What:** The code explicitly avoids `upsert` because of PostgreSQL null-uniqueness behavior, using a find-then-create pattern instead:
```ts
const existing = await prisma.userLead.findFirst({ where: { userId, companyId, ... } });
if (existing) { ... return res.status(200).json(updated); }
const lead = await prisma.userLead.create({ ... });
```

Two concurrent POST requests with the same `(userId, companyId, contactId=null)` will both pass the `findFirst` check and both attempt `create`, with one throwing a unique constraint violation (P2002) that surfaces as an unhandled 500.

**Fix:** Wrap in a transaction with `SELECT ... FOR UPDATE` or catch the P2002 error and treat it as a conflict:
```ts
} catch (err: any) {
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: "Lead already exists" });
  }
  throw err;
}
```

---

### P1-8: Demo mode `signUp` and `signIn` always use the same hardcoded `id: 'demo-user'`, overwriting any existing demo session

**File:** `src/contexts/AuthContext.jsx:79, 95`  
**What:**
```js
const demoUser = { id: 'demo-user', email, ... }
```

Every demo sign-in/sign-up produces the same user ID. Two browser tabs using different demo accounts share localStorage key `cf_onboarding_demo-user` and module-level `currentUserId = 'demo-user'`, so tab B overwrites tab A's workspace config. Less critically, every API request in demo mode sends `x-user-id: demo-user`, which maps to a single DB user if demo mode is ever used against a real backend.

**Fix:** Generate a stable UUID per browser session:
```js
const demoId = localStorage.getItem('cf_demo_id') || crypto.randomUUID()
localStorage.setItem('cf_demo_id', demoId)
const demoUser = { id: demoId, email, ... }
```

---

### P1-9: `TemplatesTab` `save()` — when editing, only saves `name` and `subject` but silently drops the body edit

**File:** `src/components/Templates/TemplatesTab.jsx:193-205`  
**What:**
```js
const save = async () => {
  if (editingId) {
    await onUpdate({ id: editingId, name: form.name, subject: form.subject })
    // body: form.body is NOT included
  } else {
    const created = await onCreate({ name: form.name, subject: ..., body: form.body || '<p></p>' })
  }
}
```

The Edit Info modal (`openEdit`) populates `form.body` from the template, but `save()` never sends `form.body` on update. Users who open Edit Info, change the body there, and click Save will have their body change silently discarded.

**Fix:**
```js
await onUpdate({ id: editingId, name: form.name, subject: form.subject, body: form.body })
```

---

### P1-10: `profile.ts` GET response never returns `resumeText` in the top-level `workspaceConfig` — the resume text always resets to empty on cross-device sync

**File:** `api/profile.ts:40-53`  
**What:** The GET response maps `resume_text` to `resumeText` at the top level, but `AppShell` reads it via `createWorkspaceConfig({ data: res.profile.workspaceConfig })`. The `workspaceConfig` column in Supabase only stores the sanitized config JSON (which has `resumeText: ''` stripped before saving — see `App.jsx:349-362`). So `resumeText` is saved to the `resume_text` column but is never injected back into `workspaceConfig` when hydrating on a second device.

**Fix:** In `AppShell`'s `fetchProfile` callback, merge `resumeText` from the top-level profile field into the workspace config data:
```js
const serverConfig = createWorkspaceConfig({
  user,
  templates,
  data: {
    ...res.profile.workspaceConfig,
    resumeText: res.profile.resumeText || '',  // inject from dedicated column
  },
})
```

---

## P2 — Degraded UX / Silent Wrong Behavior

---

### P2-1: `LeadDiscoveryTab` fires an Apollo search for every company on every page load — N uncancellable parallel API calls

**File:** `src/components/LeadDiscovery/LeadDiscoveryTab.jsx:129-144`  
**What:**
```js
uncached.forEach(async (company) => {
  try {
    const result = await apolloSearch(company.domain, company.id)
    ...
  } catch {
    setApolloCounts(prev => ({ ...prev, [company.id]: 0 }))
  }
})
```

After fetching the first page of companies (up to 20), the component fires 20 concurrent Apollo search requests in parallel. These `async` calls inside `.forEach` are not tracked, not cancelled on unmount, and not rate-limited. If the user navigates away or changes filters, stale responses will still call `setApolloCounts` on the unmounted (or re-mounted) component.

**Fix:** Move the Apollo prefetch into a queued sequential batch (or just remove it — the user already sees counts after clicking "Search contacts"). At minimum, cancel stale responses using the existing `fetchGenRef` pattern already present for company loading.

---

### P2-2: `handleCompanySelect` fires reveal requests for all contacts in parallel without rate limiting, ignoring navigation state

**File:** `src/components/LeadDiscovery/LeadDiscoveryTab.jsx:215-223`  
**What:**
```js
previews.forEach(async (p) => {
  if (!p.hasEmail) { ...; return }
  try {
    const result = await revealApolloContact(p.id)
    setRevealedEmails(prev => ({ ...prev, [p.id]: result.contact?.email ?? null }))
  } catch {
    setRevealedEmails(prev => ({ ...prev, [p.id]: null }))
  }
})
```

Up to 10 reveals fire simultaneously when a company modal opens. Apollo charges credits per reveal. There is no debounce, rate limit, or guard against double-revealing when the user opens the same company twice. `savedIds` persists only per-session and resets when the component remounts.

**Fix:** Only reveal on explicit user action (e.g., a "Reveal email" button per contact row), not automatically on modal open.

---

### P2-3: `contacts.ts` and `companies.ts` have no user-scoping — any authenticated user gets all rows from all users

**File:** `api/contacts.ts:21-35`, `api/companies.ts:31-69`  
**What:** Both endpoints filter only on `source: "yc"` and optional query params. There is no `userId` filter. This is by design for the company catalogue (shared data) but `contacts.ts` returns contacts from all users and all companies, including contacts saved by other users via Apollo enrichment.

**Fix for contacts:** Scope to the current user's saved leads:
```ts
const contacts = await prisma.contact.findMany({
  where: {
    userLeads: { some: { userId } },
    ...filters
  },
  ...
})
```

---

### P2-4: `emails.ts` `list()` — `status` filter accepts any string, not just valid enum values

**File:** `api/emails.ts:27-33`  
**What:**
```ts
...(status && { status }),
```

Unlike the leads and campaigns routes which validate against an `ALLOWED_STATUSES` array, the emails list route passes `status` straight to Prisma. Prisma will return an empty result for unknown statuses, but the caller has no indication the filter was silently ignored (no 400 error).

**Fix:**
```ts
const ALLOWED_EMAIL_STATUSES = ["draft", "sent", "failed"] as const;
if (status && !ALLOWED_EMAIL_STATUSES.includes(status as any)) {
  return res.status(400).json({ error: `Invalid status` });
}
```

---

### P2-5: `SettingsPage` SMTP and Sending Limits sections save state only in React — settings are never persisted

**File:** `src/components/Settings/SettingsPage.jsx:27`, `src/components/Settings/SettingsPage.jsx:349-351`  
**What:** `SmtpSection.save()` does:
```js
const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }
```

And `SendingLimitsSection.save()` is identical. No API call is made. The SMTP configuration and daily limits are thrown away on page refresh. The "Saved!" flash is a lie.

**Fix:** Wire these to `/api/profile` (for the workspace config fields) or create a dedicated SMTP settings API endpoint that persists to the `settings` table in Supabase.

---

### P2-6: `SettingsPage` API keys section generates keys with `uuidv4` but never persists them to the backend — all keys are lost on reload

**File:** `src/components/Settings/SettingsPage.jsx:225-228`  
**What:**
```js
const [keys, setKeys] = useState([
  { id: uuidv4(), name: 'Production', key: `cf_live_${uuidv4()...}`, ... },
])
```

API keys exist only in component state. They are never sent to the `api_keys` table in Supabase. Every page load generates a new fake "Production" key.

**Fix:** Connect to a real `/api/api-keys` endpoint backed by the `api_keys` table, storing a bcrypt hash (as the schema's comment already prescribes).

---

### P2-7: `SettingsPage` Team section sends no actual invite — local state only

**File:** `src/components/Settings/SettingsPage.jsx:297-301`  
**What:** `sendInvite()` only calls `setMembers(...)`. No email is sent, no database row is created in `team_invites`. The UI shows "Invitation pending" but nothing happens.

**Fix:** Connect to a real invite API endpoint that creates a `team_invites` row and sends an email.

---

### P2-8: `App.jsx` `persistWorkspaceConfig` silently sends the Claude API key in plaintext over the network in `workspaceConfig`

**File:** `src/App.jsx:348-362`  
**What:**
```js
const claudeKey = normalized.apiKeys?.claude || null
const sanitizedConfig = {
  ...normalized,
  apiKeys: { ...(normalized.apiKeys || {}), claude: '' },
}

saveProfile({
  workspaceConfig: sanitizedConfig,
  ...
  ...(claudeKey ? { claudeApiKey: claudeKey } : {}),
})
```

The Claude key is correctly stripped from `workspaceConfig` and sent separately via `claudeApiKey`. However, `normalized.apiKeys` also contains `openai`, `gemini`, `apollo`, and `serper` keys — these are **not** stripped and are sent inside `workspaceConfig` to `/api/profile`, which stores them as plaintext JSON in the `workspace_config` JSONB column in Supabase. These keys are readable by anyone with Supabase Studio access or via a Supabase service role query.

**Fix:** Strip all API keys from `sanitizedConfig` before persisting:
```js
const sanitizedConfig = {
  ...normalized,
  apiKeys: {},  // never persist any API keys in the workspace_config column
}
```
Persist each key individually through the encrypted `profile.ts` endpoint.

---

### P2-9: `crypto.ts` uses a fixed scrypt salt — all instances derive the same key from the same secret

**File:** `api/_lib/crypto.ts:18`  
**What:**
```ts
cachedKey = scryptSync(secret, "coldflow.profile.v1", KEY_LENGTH);
```

Using a fixed salt for key derivation is an intentional trade-off (documented in the comment), but it means every encrypted value uses the same AES-256-GCM key. If `ENCRYPTION_KEY` leaks, every encrypted field (Claude keys, Google refresh tokens) is immediately decryptable. A random per-value salt stored alongside each ciphertext would be stronger, but the current approach is acceptable only if the `ENCRYPTION_KEY` secret is managed carefully (rotated on breach, stored in Vercel Secrets, never in source).

**Risk:** If `ENCRYPTION_KEY` is ever checked into source or exposed, all user API keys and Google refresh tokens are compromised at once.

**Recommendation:** Document the key rotation procedure. Consider storing a `key_version` alongside each encrypted value so keys can be rotated without decrypting all rows at once.

---

### P2-10: `buildSubjectLine` uses `contact.name?.split(' ')[0]` — fails for contacts with null `name` silently producing an empty first name in the subject line

**File:** `api/_lib/ai/generate-email.ts:22-26`  
**What:**
```ts
const firstName = contact.name?.split(' ')[0] ?? ''
return tmpl
  .replace(/\{\{firstName\}\}/g, firstName)
```

When `contact.name` is `null`, `firstName` is `''`. The subject template `'Quick intro — {{senderName}}'` does not contain `{{firstName}}` by default, but user-defined subject templates may. The empty replacement is invisible to the user.

**Fix:** Fall back to `'there'` consistent with how `generateEmailDraft` handles the contact name in the prompt:
```ts
const firstName = contact.name?.split(' ')[0] ?? 'there'
```

---

### P2-11: `DraftsTab` uses a `ref`-based cancel pattern that does not correctly cancel in-flight fetch on unmount

**File:** `src/components/Drafts/DraftsTab.jsx:65-82`  
**What:**
```js
const cancelRef = useRef(false)
const load = useCallback(async () => {
  cancelRef.current = false  // ← reset to false at start of each load
  ...
  if (!cancelRef.current) setDrafts(...)
}, [])

useEffect(() => {
  load()
  return () => { cancelRef.current = true }
}, [load])
```

The cleanup sets `cancelRef.current = true`. But `load` itself resets it to `false` at the top of each invocation. If the component unmounts while a fetch is in flight and then a new load starts (e.g., React StrictMode double-invocation), `cancelRef` is reset to `false` before the cleanup from the first effect has any effect.

**Fix:** Use the standard `cancelled` boolean local to the effect closure instead of a shared ref:
```js
useEffect(() => {
  let cancelled = false
  const load = async () => {
    try {
      const res = await fetchEmails({ status: 'draft', limit: '200' })
      if (!cancelled) setDrafts(res?.items || [])
    } catch (err) {
      if (!cancelled) setError(err.message)
    } finally {
      if (!cancelled) setLoading(false)
    }
  }
  load()
  return () => { cancelled = true }
}, [])
```

---

### P2-12: `App.jsx` data loading `useEffect` depends on `[user]` but reads from module-level `apiGetAuth()` — access token not always available at load time

**File:** `src/App.jsx:140-171`  
**What:**
```js
useEffect(() => {
  const { userId } = apiGetAuth()
  const effectiveUser = user || userId
  if (!effectiveUser) { ...; return }
  Promise.all([fetchTemplates(), fetchSequences(), fetchCampaigns(), fetchLeads()])
    ...
}, [user])
```

The effect fires when `user` changes, but `apiGetAuth()` is a module-level read that may not be in sync with React state. `setApiAccessToken` is called inside `applySessionToApiClient` which runs inside `supabase.auth.getSession().then(...)` — asynchronously. The React state change (`setUser`) and the module-level `setApiAccessToken` may race, causing the first data load to fire with a null `accessToken`, resulting in 401 errors on all four fetches. These are swallowed with `.catch(... return { items: [] })`, so the user sees empty tabs silently.

**Fix:** Make the effect depend only on React state: pass `accessToken` through React context and use it as the dependency, or move `applySessionToApiClient` to fire synchronously before `setUser`.

---

### P2-13: `LeadDiscoveryTab` industry filter uses a `ref` to avoid stale closure in `fetchCompanies` but `fetchCompanies` callback does not include `selectedIndustriesRef` in its dependency array — `isHiring` filter is not re-read from `ref`

**File:** `src/components/LeadDiscovery/LeadDiscoveryTab.jsx:110-153`  
**What:** `fetchCompanies` reads `selectedIndustriesRef.current` directly (correct for stale-closure avoidance), but the `isHiring` state value is captured by closure. The `useCallback` dependency array is `[search, isHiring]`, which means the function is recreated correctly when `isHiring` changes. However, because `doSearch` depends on `fetchCompanies`, and `toggleIndustry` calls `doSearch`, there is a subtle ordering issue: `toggleIndustry` updates `selectedIndustriesRef.current` synchronously before calling `doSearch`, which is correct. But if React batches the `setSelectedIndustries` and re-renders before `doSearch` fires, the stale `fetchCompanies` (from before the ref update) may be called. In practice this works, but it is fragile.

The real bug is that `selectedIndustriesRef` is updated **after** the state setter but the `fetchCompanies` `useCallback` does not list `selectedIndustriesRef` in its deps — this is fine for refs, but makes the intent unclear and creates maintenance risk.

**Recommendation:** Simplify by using a single state variable for selected industries and passing it directly into `fetchCompanies` as a parameter, avoiding the ref entirely.

---

### P2-14: `vercel.json` rewrite catches all non-`api/` paths including the Vercel health check and any future function routes

**File:** `vercel.json:3-5`  
**What:**
```json
{ "source": "/((?!api/).*)", "destination": "/index.html" }
```

This is the standard SPA catch-all but it also catches `/health`, which is an API route at `api/health.ts`. Vercel resolves `/api/health` via the `api/` prefix, not via this rewrite, so the health endpoint still works. However, if a future route is placed outside `api/` (e.g., at the root), this rewrite will shadow it. The pattern also catches `/.well-known/` paths, which can break ACME HTTP-01 challenges for custom domain SSL.

**Recommendation:** Keep as-is but be aware of the limitation. If `/.well-known/` is ever needed, add a negative lookahead: `/((?!api/)(?!\\.well-known/).*)`

---

## P3 — Minor / Code Quality

---

### P3-1: `api/_lib/user.ts` — `HttpError` is defined here but `getUserId` is a dead placeholder; the file should be cleaned up

**File:** `api/_lib/user.ts`  
**What:** `getUserId` is a superseded function (replaced by `getUserIdFromRequest` in `supabaseAdmin.ts`). The file only exists because `HttpError` is exported from it. `HttpError` should be moved to a dedicated `errors.ts` lib to eliminate the confusion of an "auth" file that does no real auth.

---

### P3-2: `prisma/schema.prisma` — no `datasource.url` or `directUrl` configured

**File:** `prisma/schema.prisma:5-7`  
**What:**
```prisma
datasource db {
  provider = "postgresql"
  // url is missing!
}
```

The `url` field is absent. Prisma migrations (`prisma migrate dev`) and `prisma generate` will fail unless `DATABASE_URL` is in the environment. The `prisma.config.ts` file exists but is not shown in the schema, indicating this may rely on a non-standard config. Should have `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")`.

---

### P3-3: `scripts/_lib/apollo-client.ts` and `scripts/` folder use a separate Prisma client instance from `api/_lib/prisma.ts` — no shared connection pool

**File:** `scripts/_lib/prisma.ts`  
**What:** Scripts and API routes each instantiate their own `PrismaClient`. When scripts run alongside the dev server, this wastes connections. In a serverless environment this is fine since scripts run offline, but the duplication means two different connection-string sources, two different singleton guards, and twice the maintenance surface.

---

### P3-4: `SettingsPage` `WorkspaceProfileSection` — file upload only records the filename in state, never actually uploads the file

**File:** `src/components/Settings/SettingsPage.jsx:101-106`  
**What:**
```jsx
onChange={e => field('resumeFileName', e.target.files?.[0]?.name || '')}
```

Only `e.target.files[0].name` is stored. The actual file is never read or uploaded. This is the same pattern as `OnboardingScreen` but OnboardingScreen has the full `handleUploadResume` flow with Supabase Storage. The Settings page silently drops the file content.

---

### P3-5: `CampaignsTab` and `ContactsTab` — optimistic update rollback restores the full previous array reference, ignoring concurrent updates from other handlers

**File:** `src/App.jsx:187-208`  
**What:**
```js
const prev = templates
setTemplates(curr => curr.map(...)) // optimistic
try {
  ...
} catch (err) {
  setTemplates(() => prev)  // rollback to stale snapshot
  throw err
}
```

If two operations run concurrently (e.g., create template + update template), a rollback from one will overwrite the successful state from the other. Standard practice is to rollback only the specific item that failed, not the entire array.

---

### P3-6: `emails/generate.ts` — `ws` typed as `Record<string, any>` defeats TypeScript

**File:** `api/emails/generate.ts:116`  
**What:**
```ts
const ws = (profile.workspace_config ?? {}) as Record<string, any>
```

Using `any` here means type errors in `ws.senderName`, `ws.senderRole` etc. are invisible to the compiler. If the `workspace_config` shape changes, this silently breaks at runtime.

**Fix:** Define a typed interface for `WorkspaceConfig` and use it here.

---

### P3-7: `OnboardingScreen` — `useEffect` with `onSaveDraft` in deps runs on every parent re-render if `onSaveDraft` is not memoized

**File:** `src/components/Onboarding/OnboardingScreen.jsx:461-463`  
**What:** `onSaveDraft` is `saveOnboardingDraft` which is wrapped in `useCallback([templates, user])` in `App.jsx`. This is correct. However if templates or user change (e.g., after data load), `onSaveDraft` gets a new reference, triggering the effect and calling `saveOnboardingDraft` mid-onboarding, potentially overwriting partial user input with the current form state. See also P1-4.

---

### P3-8: `health.ts` endpoint exposes total company and contact counts to unauthenticated callers

**File:** `api/health.ts`  
**What:** The health endpoint returns `{ ok: true, companies: N, contacts: N }` with no auth check. While not a critical leak, exposing aggregate database counts is unnecessary for a liveness check.

**Fix:** Return only `{ ok: true }` or guard behind auth.

---

### P3-9: `supabase/schema.sql` — two `INSERT` policies on `storage.objects` and no `DELETE` for `storage.objects for update` using the wrong operation

**File:** `supabase/schema.sql:238-258`  
**What:** The storage policy uses `for update` without a `WITH CHECK` clause. Supabase storage UPDATE policies require `using` (ownership check) which is present, but omitting `with check` means the policy silently uses `USING` for both the existing row and the new row. This is usually fine for updates but is easy to get wrong if the path changes during an update.

This is a minor schema correctness issue, not exploitable.

---

### P3-10: `src/lib/api.js` — module-level mutable variables for auth state create subtle ordering bugs under HMR

**File:** `src/lib/api.js:4-5`  
**What:**
```js
let currentUserId = null
let currentAccessToken = null
```

These are module-level mutable variables. Vite HMR reloads modules but does not re-run `setApiUserId` / `setApiAccessToken`, so after a hot reload the auth state is lost and all API requests return 401 until the page is manually refreshed or the session restores.

**Fix:** Move auth state into React context and pass it via request headers at call time, or at minimum call `applySessionToApiClient` inside the Supabase `onAuthStateChange` handler (which it already does) and ensure HMR preserves the module state with `import.meta.hot.accept`.

---

## Schema / Architecture Notes (not bugs, but worth knowing)

1. **Dual-schema problem:** The app has two separate data models — Prisma (PostgreSQL via Neon) for companies/contacts/leads/emails, and Supabase (PostgreSQL) for user data. `supabase/schema.sql` defines its own `templates`, `sequences`, `campaigns`, and `contacts` tables that duplicate the Prisma schema. The application currently uses only the Prisma tables for most data and Supabase only for `user_profiles`. The Supabase-side `templates`, `sequences`, `campaigns`, `contacts` tables are not used by the API routes and create confusion about which is the canonical store.

2. **No `maxDuration` set for long-running functions:** `api/emails/generate.ts` makes two sequential Anthropic API calls (generate + humanize) plus optional Apollo reveal, which can take 10–20 seconds. Vercel's default serverless function timeout is 10 seconds on hobby plans. Setting `maxDuration` in `vercel.json` is strongly recommended for this route.

---

_Reviewed: 2026-04-26_  
_Reviewer: Code audit (exhaustive manual review)_
