## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `docs/context.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Architectural decisions in force

### Auth + Gmail
- **Sign-in-with-Google is identity-only.** `AuthContext.tsx` `GOOGLE_AUTH_SCOPES` is `['openid', 'email', 'profile']` — no Gmail scope.
- **Gmail send is a separate explicit grant.** The user clicks Connect from onboarding or Settings → Account, which calls `/api/google/connect` to start an OAuth flow with `gmail.send` + `prompt=consent + access_type=offline` and stores a refresh token. There is no automatic reconciliation after sign-in — `connectGoogle()` in `AuthContext.tsx` is the single entry point for both the first-grant and the revoked-token reconnect cases.

### Claude key
- **Host-managed only.** Server reads `process.env.ANTHROPIC_API_KEY` (`server/lib/sender-profile.ts` `resolveClaudeKey`). Per-user BYO-key path is retired; `claude_api_key_encrypted` column stays in the schema for migration safety but nothing reads or writes it. `/api/profile` returns `hasClaudeKey: !!process.env.ANTHROPIC_API_KEY` so the missing-key warning hides when env is set.

### Audience filter
- **No headcount.** Field retired from the wizard, audience type, and `audienceToPrismaWhere`. `Company.headcount` column stays unused. Funding stage carries the same signal.
- **Region**: US / International / Remote (Hiring is its own row, not a region).
- **Stage filter is ordinal-aware** (`scripts/_lib/stages.ts`, `expandStageFilter`). Picking `Series C+` expands to `IN [Series C+, Series C, Series D, Series E, ...]` so granular Pear-tagged rows surface alongside a16z/Accel's legacy `Series C+` aggregation bucket. Exact-stage filters (`Series C`, `Series D`, etc.) stay as equality matches. Series A-Z ordinals come from the letter so adding `Series F` data needs no code change. Wizard renders the union of realized DB stages and `CANONICAL_STAGES` so `Series C / D / E` chips appear even before the DB has rows in those buckets.
- **YC batch picker** is contextual: only renders below the Signal row when `signal:yc-backed` is selected. Toggling yc-backed off clears any selected batch.
- **Audience preview samples** are randomly picked (parallel random offsets for large pools, JS shuffle for small) — not alphabetical.
- **DB size**: was ~12.3k total / ~10.3k verified on 2026-05-15; grew to 40k+ verified after the 2026-05-21/22 expansion sprint (accelerators + long-tail VCs + Exa-discovery sweeps). Always re-count before quoting — `npx tsx -e "import('./scripts/_lib/prisma.js').then(({prisma}) => prisma.company.count({where:{isVerified:true}}).then(c => {console.log(c); process.exit()}))"` or write a one-off in `scripts/`.
- **Coverage percentages** (snapshot at 6,281 verified — stale denominator, ratios likely still roughly hold but verify before quoting): region 94.9%, industry 99.4%, `vertical:*` 62.7%, `tech:*` 68.4%, `signal:*` 93.3%, `investor:*` 41.3%, `model:*` 48.2%. Only 393 verified rows (6.3% at the time) were missing both `vertical:*` and `tech:*`. The LLM enrichment scripts (`enrich-industries-llm.ts`, `enrich-locations-llm.ts`, `backfill-tags.ts`) closed the early-stage gaps; remaining sparsity is mostly companies that genuinely don't fit the closed namespace (e.g., a Danish pawnshop has no `vertical:fintech` slot).
- **Stage coverage** (post-Phase-1.5 audit): ~75% of verified rows have a stage label. The five remaining null-heavy sources (Sequoia, Greylock, Bessemer, FoundersFund, GV) confirmed empirically as having no stage data on their public surface — Sanity/WP schemas lack the field, detail pages don't render it. Closing those needs third-party enrichment (Crunchbase open-data / recent-funding feed) — out of scope until a real need surfaces. See `docs/scraping-research.md` for the full audit.
- **Region-dark companies are mostly closed out**: ~321 verified rows (5.1%) have `region: null`. The major VC sources (a16z, bessemer, sequoia, gv) don't expose HQ on their public sites/APIs, and Apollo's free `/mixed_companies/search` doesn't return city/country either (only paid `/organizations/enrich` does). YC + KP + Accel + FirstRound + Greylock + TheHub already capture what's available. The LLM enrichment in `enrich-locations-llm.ts` returns Unknown ~99% of the time on these because descriptions don't reveal HQ — that's correct, not a bug. Remaining paths to fill the rest: Apollo paid enrich (~321 credits) or web-grounded retrieval (Exa/Tavily) — both viable but not currently a bottleneck.
- **Sector + Tech filters cover the `function:*` namespace too**: function tags were merged into vertical (productivity, hr, sales, marketing, design, content, customer-support) or tech (adtech, communication, search) — there is no `function:*` namespace anymore.
- **Wizard filter chips are served from a precomputed snapshot table** (`CompanyOptionsSnapshot` singleton row). `/api/campaign-options` does a single PK lookup; the expensive aggregation runs in `scripts/refresh-company-options.ts` and **needs to be re-run after every ingest session** or new sources won't surface in the wizard. See ADR-0006.
- **Random discovery is a DB anti-join, not a JS shuffle.** `/api/companies?random=1` runs raw SQL `SELECT … FROM Company WHERE … AND NOT EXISTS (DiscoverySeenCompany) AND NOT EXISTS (UserLead) ORDER BY random() LIMIT N` (`server/routes/companies.ts:selectRandomDiscoveryCompanies` + `server/lib/audience-pool.ts`). The `take` value is clamped to `[1, 200]` before raw interpolation into `LIMIT ${take}`. See ADR-0008.
- **Campaign filter columns** `filterRegion / filterStage / filterBatch` are `String[]` on `Campaign` (schema.prisma:249-251). E2E tests expect `[]`, not `null`, when no filter is set.
- **Recent perf-sprint migrations** (2026-05-22): `20260522230500_company_partial_indexes`, `20260522233500_company_fk_indexes_and_autovacuum`, `20260523001500_company_options_snapshot`, `20260523003000_drop_unused_indexes`. The composite + partial + FK indexes power the snapshot aggregation and the random anti-join; the autovacuum tuning targets `Company`'s write churn from ingest runs.

### Settings
- 3 tabs: **Profile / Sending / Account**. Profile carries sender identity and resume/background context; Sending carries defaults, send limits, and reusable attachments; Account carries sign-out, Gmail connection, and delete-account actions. Tab labels show an amber dot when their section has incomplete setup.
- Removed fields: `signature` (was never wired into generation), `timeZone` (never read by server), BYO Claude key input. The Style tab and quiz were moved to `archive/style-quiz` for v1 — drafts now use a built-in `Style: direct, concise, specific — 80–120 words` line in the AI prompt without per-user tuning. The Integrations tab is also retired; Gmail connection lives in Account.

### Layout
- **Sidebar**: forest-green circular brand badge + wordmark, no divider. Main rail = Home + Templates. Bottom rail = Settings + user menu. Active and Paused campaigns appear inline under a CAMPAIGNS section with a `+` button that opens the create wizard via `/dashboard?new=1`. When collapsed, campaigns render as small status dots (vertical column, name on hover via title).
- **No global page-header bar** — the previous sticky strip that just repeated the active tab label is gone. Sidebar conveys active tab; pages carry their own titles.
- **Workspace Overview**: next-action hero (computed from leads/drafts/sent counts) + clickable stats strip. No dead Status/Batch/Template cards.

### Email generation
- Templates carry merge tags (`{{first_name}}`, `{{company}}`, etc.). Claude rewrites the body per-recipient using the lead's company context — merge tags are the skeleton, the AI does the personalization.
- **Personalization research** (`server/lib/ai/research-fit-angle.ts`): `researchCompanyDossierHybrid` is the production retrieval path. Exa first (neural ranking, recency-filtered — default 180d, override via `EXA_RECENCY_DAYS` env); Tavily fallback only when Exa returns 0 results. Tavily-only (`researchCompanyDossier`) and Exa-only (`researchCompanyDossierExa`) exports stay live for the A/B harness (`scripts/smoke-exa-vs-tavily.ts`). Same synthesis prompt across providers — retrieval is the only confound. Dossier caches on `Company.researchDossier`; slots older than 150 days are treated as cache-miss (`DOSSIER_TTL_MS` + `slotIsFresh` in `server/lib/draft-generation.ts`) so the next draft for that company triggers fresh research. No background refresh, no per-company override. See ADR-0007. `pickFitAngle` runs on top per-user, token-only.
- Hybrid is intentionally **Exa-first, Tavily-fallback on 0 results** — not a parallel merge. Live A/B showed mixing Exa's recent launches with Tavily's aggregator-spam pages (status checkers, email-format scrapers) actively dilutes synthesis quality. Fallback is the rescue branch for web-invisible companies, not a hedge — it rarely fires in practice (0/10 in the last eval).
- **Onboarding preview** (`server/routes/preview-fit-angle.ts`): runs the real `pickFitAngle` against a hardcoded `ANTHROPIC_PREVIEW_DOSSIER` so the Step 2 template preview reflects the user's resume model-picked, not keyword-matched. Recipient is fixed (Anthropic / Dario), dossier is pre-baked from a real Exa run on `anthropic.com`. **Refresh the constant ~quarterly** or when Anthropic ships a major product the surfaces no longer mention — `npx tsx scripts/smoke-exa-vs-tavily.ts --domain anthropic.com` regenerates the values. No automation yet; staleness cost is "preview cites old product names," not a real bug.
- Onboarding template step shows merge-tag chips that insert at the caret of the focused subject/body field.
- **Merge-tag surfaces are role-complete** (templates editor, wizard preview, onboarding, MergeTagNode `KNOWN_TAGS`, `PREVIEW_SAMPLE`/`PREVIEW_FALLBACK`). All six personalization tags covered: `{{feature_line}}` + `{{fit_angle}}` (eng/product), `{{trigger_line}}` + `{{proof_of_motion}}` (gtm), `{{inflection_line}}` + `{{system_built}}` (ops). Adding a new tag means touching every one of those five surfaces, or the editor will render literal `{{...}}` for users on roles that use the new tag.
- **Change-angle path is role-aware** (`server/routes/emails/angle.ts`). Discriminates eng/gtm/ops from which input field the body carries (`featureLine` | `triggerLine` | `inflectionLine`) — there's no separate `role` param so a malformed request can't swap fields on the wrong slot. Frontend `AnglePicker` reads `Email`'s populated role column to pick a role and reads the matching dossier slot from the envelope. `pickGtmAngle` and `pickOpsAngle` each accept a `force<X>Line` param mirroring `pickFitAngle.forceFeatureLine`.
- **Partial-personalization warning** (`DraftsTab.tsx:detectDroppedTags`): when the picker fills only one half of a role's (company-side, candidate-side) pair, `dropEmptyTagParagraphs` drops the paragraph anchored on the empty tag. The amber banner names the dropped tag + recipient. Known gap: when *both* halves come back null we can't detect the role (no column has a signal), so the warning silently doesn't fire — generic-looking drafts get no banner. Closing this needs a server-side role tag on `Email`.
- Bug 08 fix: when Apollo's title-filtered search (`searchContacts` with `TARGET_TITLES`) returns 0, the route silently retries without the title filter and flags `usedFallback: true` so the UI hints "no senior matches, showing all".

### Free Apollo enrichment scripts
- `scripts/enrich-org-metadata.ts` — fills `Company.industry` for verified companies missing it. Calls `searchOrganization` (free), translates returned SIC/NAICS codes via `scripts/_lib/sic-mapping.ts`. Tags update via `tagFromTopic(industry)`. SIC_DEBUG=1 logs unmatched codes.
- `scripts/enrich-contact-previews.ts` — persists Apollo `searchContacts` previews as Contact rows with `email=null`, `source=apollo-preview`. Idempotent via (companyId, name, title, source) check. `--skip-with-contacts` skips companies that already have any contacts.
- `scripts/enrich-apollo-emails.ts` — the only script that costs Apollo credits (1 per `revealPerson` call). Requires `--max-reveals N` cap.

### Ingest pipeline
- **One pattern: hand-coded adapters under `scripts/ingest-<source>.ts`** (yc + ~67 hand-coded VC/accelerator adapters + the bulk-discovery adapter `exa-discovery`; see `scripts/ingest-*.ts` for the live set — count drifts as new sources are added). Each implements an `IngestorAdapter` and calls `runIngestor(adapter)` in `scripts/_lib/ingestor.ts`, which handles domain extraction, dedupe, free-hosting filter, tag/quality assembly, concurrency, and retry. A previous JSON-manifest framework was tried and removed — every VC's portfolio is custom-shaped, so per-source TS adapters are faster to ship and easier to debug than extending a generic schema for every new shape.
- **Stage normalizers** in YC, a16z, and Accel adapters preserve post-B precision: YC `Growth` → `Series B` (was `Series A`), a16z `growth`/`late` → `Series C+` (was `Series B`), Accel `growth` → `Series C+`. a16z also has a `Venture` tag (post-A core fund, ~275 of 835 rows) mapped to `Series A` — without this, those rows ingest as `stage: null`. See commits `2e35907` and `fb7332f` for the rationale.
- **Pear adapter** (`scripts/ingest-pear.ts`) resolves WP taxonomy term IDs to labels by fetching `current_stage` and `pear_vc_company_sector` endpoints once at startup. Skips rows tagged `Acquired` or `IPO`. Website preference is `meta.website_url` then `link`, rejecting `pear.vc` hosts (some "links" point to Pear's own announcement posts).
- **Stage cross-source overwrites are last-non-null-write-wins.** `upsertCompany` writes `stage` whenever the source emits a non-null value; null doesn't clobber. Practical implication: ingest order matters when a company is in multiple portfolios (e.g. re-running Sequoia after Pear leaves Pear's stage). When source-of-truth stage is unavailable, `scripts/_lib/stage-defaults.ts` infers from investor-thesis tags (insight/GA/summit → Series C+; battery → Series B; boxgroup/initialized/hoxton/pear → Seed; yc-backed → Seed) and tags the row `signal:stage-inferred`. The marker is stripped automatically when a source-of-truth stage arrives later. Crunchbase / external-enrichment is **explicitly de-scoped** per the `.planning/STATE.md` "no Crunchbase" decision.
- **`Company.source` is also last-write-wins.** A row labeled `source: "general-catalyst"` may carry investor tags from prior adapters (`investor:sequoia`, `investor:a16z`, etc.) — those accumulate via `mergeTags` in `reconcileCompany`, never get clobbered. The wizard's investor filter ORs across the full tag set, so filtering by an investor surfaces every row that investor has touched, not just rows where their adapter ran last. When interpreting per-source row counts (e.g. `audit-stages.ts`, `--verified-only` queries by `source`), remember the source label only reflects the most recent adapter to write that domain — the upstream investor signal may be richer.
- **`scripts/audit-stages.ts`** prints `(source, stage)` distribution from the live DB with a global stage roll-up. Use before/after each ingest run to verify normalizer changes are landing rows where expected. `--verified-only` mirrors the wizard's visible set.
- **Exa-discovery is a separate ingest pattern.** `scripts/ingest-exa-discovery.ts` calls Exa's `/search` with `category=company` to surface companies by topical query rather than by which VC backed them — fills the gap that per-VC adapters can't reach (firms with no public portfolio, bootstrapped companies). Source slug is the fixed `exa-discovery`; the per-query `--topic` slug is attached as a topics tag for downstream wizard filtering. Caveat: Exa's company-category index doesn't support `startPublishedDate` (semantic-only) and includes public-traded companies (no exit filter — handle at campaign time). See `docs/scraping-research.md` Part 6.

### Toast notifications
- Single `ToastProvider` mounted at `App.tsx` inside `AuthProvider`. `useToast()` from `src/contexts/ToastContext.tsx` returns `{ showToast, dismissToast, reportError }`. `showToast` returns the id so callers can dismiss specific toasts (DraftsTab's Undo flow uses this).
- Stacking: up to 3 concurrent toasts, ordered top-to-bottom; oldest non-pinned evicts when overflowing. `pinned: true` toasts (e.g. DraftsTab's 5s Undo) are exempt from eviction.
- Hover pauses the auto-dismiss timer; action-button clicks auto-dismiss. Error toasts use `role=alert` / `aria-live=assertive`; others stay polite.
- Migrated from per-page `useState<Toast | null>` + `<Toast />` JSX. Legacy `src/hooks/useToast.ts` re-exports the context hook for backward compatibility with old imports.

### Tests + e2e
- ~575 unit (vitest) + ~83 e2e (playwright) across 20 spec files (as of 2026-05-22 — numbers drift, re-count with `grep -rE "^\s*(test|it)\(" src server | wc -l` and `grep -rE "^\s*test\(" e2e | wc -l` before quoting). Run via `npx vitest run` and `npx playwright test`.
- e2e contracts that constrain Settings work: `gmail-connect.spec.ts` requires exactly the **Profile / Sending / Account** tabs, asserts Style and Integrations are absent, and expects the Gmail `Connect` button on the Account tab.
- e2e contracts that constrain Sidebar: `smoke.spec.ts` "sidebar exposes the three top-level tabs" asserts Home / Templates / Settings.
- e2e selector conventions are in `e2e/README.md` — **pin behavior, not copy**. Tests broke from UI text drift on 2026-05-15; the doc and refactored tests show the working pattern (network interception > URL match > role/label > seeded data > copy as last resort).

### Pre-push hook
- `.githooks/pre-push` runs `tsc -b` + `vitest run` before any push to `main`. Bypass with `git push --no-verify`.
- Activated via `git config core.hooksPath .githooks` (one-time per clone). Hook is tracked in repo.
- E2E is intentionally NOT run pre-push (needs Docker + Supabase + ~3 min). CI handles that.

### Database migrations
- **Prod schema changes flow through `prisma migrate`, never `db push`.** Workflow:
  1. `npm run db:migrate:create -- <name>` — generates a versioned SQL file in `prisma/migrations/` against your local Supabase. Review and commit.
  2. `npm run db:migrate:deploy` — applies pending migrations to prod (reads `DIRECT_URL` from `.env`, prompts for confirmation).
- **Local exploration: `npm run db:push:local`** is fine for fast iteration while a schema is in flux. Once you're settled, run `db:migrate:create` to capture the change.
- **`db:push:prod` is retired** (2026-05-15). The script errors and prints the new workflow if you try it.
- Baselined to `0_init` on 2026-05-15 — that single migration represents the entire schema at that point in time, marked already-applied via `prisma migrate resolve`. Future migrations are deltas on top.
- Historical ad-hoc migrations live in `prisma/legacy/` for reference only — they're not part of the migration history.
- The `_prisma_migrations` table in prod tracks what's been applied. Don't drop it.
- **Non-schema migrations** (RLS toggles, role grants, anything `prisma migrate dev` won't detect from a `schema.prisma` diff): create the directory + `migration.sql` manually in `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/`, then `db:migrate:deploy`. Example: `20260520055011_enable_rls_prisma_migrations`.
- **RLS on `_prisma_migrations`** is on (2026-05-20) so Supabase's PostgREST anon endpoint can't read migration metadata. Prisma itself connects via `DIRECT_URL` as a postgres-role superuser (bypasses RLS) so migrate commands still work.

### Landing page
- **Build-time live counts**: the hero proof line ("Search across X startups from Y portfolio sources") is baked at production build time. `vite.config.ts` invokes `scripts/print-stats.ts` which queries Prisma for `Company.count()` and distinct `source` values; results inject as `__SPARROW_STARTUP_COUNT__` / `__SPARROW_SOURCE_COUNT__` globals (declared in `src/build-globals.d.ts`, consumed in `Hero.tsx`). Dev mode skips the query and uses the hardcoded fallback (12317 / 44) so `vite dev` works without `DATABASE_URL`. Production builds without DB access (PR previews, fresh CI) also fall back silently so the page still renders.
- **CTA shadow tokens** (`shadow-cta`, `shadow-cta-hover` in `tailwind.config.js`): louder than `shadow-active` because the landing CTA is the page's marquee call to action. In-product primaries still use `shadow-active`.
- **Impeccable skill context** (`PRODUCT.md`, `DESIGN.md`, `DESIGN.json` at repo root): gitignored, per-contributor. Each developer runs the skill's `teach` command locally to generate their own. Not project artifacts.

## Conventions
- Atomic commits, one logical change each, multiline messages explaining WHY.
- TDD when adding new behavior: failing test first.
- Skip skill prompts that don't apply (Vite + Vercel Functions + Supabase, not Next.js / Auth.js / Vercel AI SDK).
- Don't write to `node_modules`, don't bypass git hooks (`--no-verify`), don't push to main without user approval.
- `.scratch/` is gitignored (project's local-issues convention).
