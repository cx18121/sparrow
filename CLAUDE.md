## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `docs/context.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Architectural decisions in force

### Auth + Gmail
- Sign-in with Google requests identity AND `gmail.send` in one consent screen (`AuthContext.tsx` `GOOGLE_AUTH_SCOPES`). After sign-in, `reconcileGmailGrant()` persists `provider_refresh_token` if Supabase emitted one (first-grant case), or auto-redirects through `/api/google/connect` to mint one via `prompt=consent + access_type=offline` (returning users). Settings → Connect stays as the manual reconnect path for revoked tokens and for password-signed-up users.
- `cf_gmail_reconcile_pending` sessionStorage marker gates reconciliation so it only runs after a Google sign-in (not after token refresh, password sign-in, etc.).

### Claude key
- **Host-managed only.** Server reads `process.env.ANTHROPIC_API_KEY` (`server/lib/sender-profile.ts` `resolveClaudeKey`). Per-user BYO-key path is retired; `claude_api_key_encrypted` column stays in the schema for migration safety but nothing reads or writes it. `/api/profile` returns `hasClaudeKey: !!process.env.ANTHROPIC_API_KEY` so the missing-key warning hides when env is set.

### Audience filter
- **No headcount.** Field retired from the wizard, audience type, and `audienceToPrismaWhere`. `Company.headcount` column stays unused. Funding stage carries the same signal.
- **Region**: US / International / Remote (Hiring is its own row, not a region).
- **Stage filter is ordinal-aware** (`scripts/_lib/stages.ts`, `expandStageFilter`). Picking `Series C+` expands to `IN [Series C+, Series C, Series D, Series E, ...]` so granular Pear-tagged rows surface alongside a16z/Accel's legacy `Series C+` aggregation bucket. Exact-stage filters (`Series C`, `Series D`, etc.) stay as equality matches. Series A-Z ordinals come from the letter so adding `Series F` data needs no code change. Wizard renders the union of realized DB stages and `CANONICAL_STAGES` so `Series C / D / E` chips appear even before the DB has rows in those buckets.
- **YC batch picker** is contextual: only renders below the Signal row when `signal:yc-backed` is selected. Toggling yc-backed off clears any selected batch.
- **Audience preview samples** are randomly picked (parallel random offsets for large pools, JS shuffle for small) — not alphabetical.
- **Data coverage** (snapshot, 6,281 verified companies): region 94.9%, industry 99.4%, `vertical:*` 62.7%, `tech:*` 68.4%, `signal:*` 93.3%, `investor:*` 41.3%, `model:*` 48.2%. Only 393 verified rows (6.3%) are missing both `vertical:*` and `tech:*`. The LLM enrichment scripts (`enrich-industries-llm.ts`, `enrich-locations-llm.ts`, `backfill-tags.ts`) closed the early-stage gaps; remaining sparsity is mostly companies that genuinely don't fit the closed namespace (e.g., a Danish pawnshop has no `vertical:fintech` slot).
- **Stage coverage** (post-Phase-1.5 audit): ~75% of verified rows have a stage label. The five remaining null-heavy sources (Sequoia, Greylock, Bessemer, FoundersFund, GV) confirmed empirically as having no stage data on their public surface — Sanity/WP schemas lack the field, detail pages don't render it. Closing those needs third-party enrichment (Crunchbase open-data / recent-funding feed) — out of scope until a real need surfaces. See `docs/scraping-research.md` for the full audit.
- **Region-dark companies are mostly closed out**: ~321 verified rows (5.1%) have `region: null`. The major VC sources (a16z, bessemer, sequoia, gv) don't expose HQ on their public sites/APIs, and Apollo's free `/mixed_companies/search` doesn't return city/country either (only paid `/organizations/enrich` does). YC + KP + Accel + FirstRound + Greylock + TheHub already capture what's available. The LLM enrichment in `enrich-locations-llm.ts` returns Unknown ~99% of the time on these because descriptions don't reveal HQ — that's correct, not a bug. Remaining paths to fill the rest: Apollo paid enrich (~321 credits) or web-grounded retrieval (Exa/Tavily) — both viable but not currently a bottleneck.
- **Sector + Tech filters cover the `function:*` namespace too**: function tags were merged into vertical (productivity, hr, sales, marketing, design, content, customer-support) or tech (adtech, communication, search) — there is no `function:*` namespace anymore.

### Settings
- 3 tabs: **Profile / Sending / Account**. Profile carries sender identity and resume/background context; Sending carries defaults, send limits, and reusable attachments; Account carries sign-out, Gmail connection, and delete-account actions. Tab labels show an amber dot when their section has incomplete setup.
- Removed fields: `signature` (was never wired into generation), `timeZone` (never read by server), BYO Claude key input. The Style tab and quiz were moved to `archive/style-quiz` for v1 — drafts now use a built-in `Style: direct, concise, specific — 80–120 words` line in the AI prompt without per-user tuning. The Integrations tab is also retired; Gmail connection lives in Account.

### Layout
- **Sidebar**: forest-green circular brand badge + wordmark, no divider. Main rail = Home + Templates. Bottom rail = Settings + user menu. Active and Paused campaigns appear inline under a CAMPAIGNS section with a `+` button that opens the create wizard via `/dashboard?new=1`. When collapsed, campaigns render as small status dots (vertical column, name on hover via title).
- **No global page-header bar** — the previous sticky strip that just repeated the active tab label is gone. Sidebar conveys active tab; pages carry their own titles.
- **Workspace Overview**: next-action hero (computed from leads/drafts/sent counts) + clickable stats strip. No dead Status/Batch/Template cards.

### Email generation
- Templates carry merge tags (`{{first_name}}`, `{{company}}`, etc.). Claude rewrites the body per-recipient using the lead's company context — merge tags are the skeleton, the AI does the personalization.
- **Personalization research** (`server/lib/ai/research-fit-angle.ts`): `researchCompanyDossierHybrid` is the production retrieval path. Exa first (neural ranking, recency-filtered — default 180d, override via `EXA_RECENCY_DAYS` env); Tavily fallback only when Exa returns 0 results. Tavily-only (`researchCompanyDossier`) and Exa-only (`researchCompanyDossierExa`) exports stay live for the A/B harness (`scripts/smoke-exa-vs-tavily.ts`). Same synthesis prompt across providers — retrieval is the only confound. Dossier caches on `Company.researchDossier`; current production treats any cached dossier as fresh until a manual re-research path is added. `pickFitAngle` runs on top per-user, token-only.
- Hybrid is intentionally **Exa-first, Tavily-fallback on 0 results** — not a parallel merge. Live A/B showed mixing Exa's recent launches with Tavily's aggregator-spam pages (status checkers, email-format scrapers) actively dilutes synthesis quality. Fallback is the rescue branch for web-invisible companies, not a hedge — it rarely fires in practice (0/10 in the last eval).
- **Onboarding preview** (`server/routes/preview-fit-angle.ts`): runs the real `pickFitAngle` against a hardcoded `ANTHROPIC_PREVIEW_DOSSIER` so the Step 2 template preview reflects the user's resume model-picked, not keyword-matched. Recipient is fixed (Anthropic / Dario), dossier is pre-baked from a real Exa run on `anthropic.com`. **Refresh the constant ~quarterly** or when Anthropic ships a major product the surfaces no longer mention — `npx tsx scripts/smoke-exa-vs-tavily.ts --domain anthropic.com` regenerates the values. No automation yet; staleness cost is "preview cites old product names," not a real bug.
- Onboarding template step shows merge-tag chips that insert at the caret of the focused subject/body field.
- Bug 08 fix: when Apollo's title-filtered search (`searchContacts` with `TARGET_TITLES`) returns 0, the route silently retries without the title filter and flags `usedFallback: true` so the UI hints "no senior matches, showing all".

### Free Apollo enrichment scripts
- `scripts/enrich-org-metadata.ts` — fills `Company.industry` for verified companies missing it. Calls `searchOrganization` (free), translates returned SIC/NAICS codes via `scripts/_lib/sic-mapping.ts`. Tags update via `tagFromTopic(industry)`. SIC_DEBUG=1 logs unmatched codes.
- `scripts/enrich-contact-previews.ts` — persists Apollo `searchContacts` previews as Contact rows with `email=null`, `source=apollo-preview`. Idempotent via (companyId, name, title, source) check. `--skip-with-contacts` skips companies that already have any contacts.
- `scripts/enrich-apollo-emails.ts` — the only script that costs Apollo credits (1 per `revealPerson` call). Requires `--max-reveals N` cap.

### Ingest pipeline
- Hand-coded adapters under `scripts/ingest-<source>.ts` (yc, sequoia, a16z, kleinerperkins, foundersfund, greylock, accel, bessemer, firstround, gv, hn-hiring, thehub, gregslist, startups-gallery). Each implements an `IngestorAdapter` and calls `runIngestor(adapter)` in `scripts/_lib/ingestor.ts`, which handles domain extraction, dedupe, free-hosting filter, tag/quality assembly, concurrency, and retry.
- **Manifest framework** (`scripts/_lib/manifest-ingestor.ts`, `scripts/ingest-from-manifest.ts`): JSON sources under `sources/<slug>.json` for two strategies — `wp-rest` (WordPress REST endpoints, with optional taxonomy resolution and multi-path fallback for self-host URL rejection) and `html` (single-page cheerio scraping). Both emit `CompanyRecord[]` into the same `runIngestor` pipeline. Currently used by `sources/pear.json` and `sources/wave.json`. **Don't extend the framework further for new shapes** (detail-page hops, JS-rendered pages, Load-more pagination) — hand-code those instead. Manifest path pays off only when a source fits the existing schema within ~30 lines of edits.
- **Stage normalizers** in YC, a16z, and Accel adapters preserve post-B precision: YC `Growth` → `Series B` (was `Series A`), a16z `growth`/`late` → `Series C+` (was `Series B`), Accel `growth` → `Series C+`. a16z also has a `Venture` tag (post-A core fund, ~275 of 835 rows) mapped to `Series A` — without this, those rows ingest as `stage: null`. See commits `2e35907` and `fb7332f` for the rationale.
- **Stage cross-source overwrites are last-non-null-write-wins.** `upsertCompany` writes `stage` whenever the source emits a non-null value; null doesn't clobber. Practical implication: ingest order matters when a company is in multiple portfolios (e.g. re-running Sequoia after Pear leaves Pear's stage). The canonical fix is post-ingest enrichment from a recency-aware source (Crunchbase open-data), not adding per-field source-priority logic.
- **`scripts/audit-stages.ts`** prints `(source, stage)` distribution from the live DB with a global stage roll-up. Use before/after each ingest run to verify normalizer changes are landing rows where expected. `--verified-only` mirrors the wizard's visible set.

### Toast notifications
- Single `ToastProvider` mounted at `App.tsx` inside `AuthProvider`. `useToast()` from `src/contexts/ToastContext.tsx` returns `{ showToast, dismissToast, reportError }`. `showToast` returns the id so callers can dismiss specific toasts (DraftsTab's Undo flow uses this).
- Stacking: up to 3 concurrent toasts, ordered top-to-bottom; oldest non-pinned evicts when overflowing. `pinned: true` toasts (e.g. DraftsTab's 5s Undo) are exempt from eviction.
- Hover pauses the auto-dismiss timer; action-button clicks auto-dismiss. Error toasts use `role=alert` / `aria-live=assertive`; others stay polite.
- Migrated from per-page `useState<Toast | null>` + `<Toast />` JSX. Legacy `src/hooks/useToast.ts` re-exports the context hook for backward compatibility with old imports.

### Tests + e2e
- 534 unit (vitest) + 29 e2e (playwright). Run via `npx vitest run` and `npx playwright test`.
- e2e contracts that constrain Settings work: `gmail-connect.spec.ts` requires exactly the **Profile / Sending / Account** tabs, asserts Style and Integrations are absent, and expects the Gmail `Connect` button on the Account tab.
- e2e contracts that constrain Sidebar: `smoke.spec.ts` "sidebar exposes the three top-level tabs" asserts Home / Templates / Settings.

## Conventions
- Atomic commits, one logical change each, multiline messages explaining WHY.
- TDD when adding new behavior: failing test first.
- Skip skill prompts that don't apply (Vite + Vercel Functions + Supabase, not Next.js / Auth.js / Vercel AI SDK).
- Don't write to `node_modules`, don't bypass git hooks (`--no-verify`), don't push to main without user approval.
- `.scratch/` is gitignored (project's local-issues convention).
