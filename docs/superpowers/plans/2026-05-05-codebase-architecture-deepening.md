# Codebase Architecture Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the Draft, Email delivery, Profile setup, Workspace config, and Campaign audience modules without changing user-visible behavior except where tests expose an existing bug.

**Architecture:** Work in narrow, reversible passes. Each pass first adds tests around the intended module interface, watches them fail where behavior is missing or the module does not exist, then moves implementation behind a deeper seam while keeping existing routes and pages thin adapters.

**Tech Stack:** Vite, React, TypeScript, Vercel Functions, Prisma, Supabase, Vitest, Playwright.

---

## File Structure

- `server/lib/email-cache.ts`: shared cache module for dashboard Draft/Sent query cache keys and invalidation.
- `server/lib/email-query.ts`: Email queue read module for Draft/Sent lists, combined dashboard reads, and sent-today counts.
- `server/routes/emails.ts`: route adapter only; delegates Email queue reads/writes to library modules.
- `server/lib/send-draft.ts`: Email delivery module; depends on `email-cache.ts` for post-send invalidation.
- `src/lib/draftQueue.ts`: pure Draft queue/readiness helpers used by the UI.
- `src/hooks/useDraftQueueController.ts`: client Draft queue interaction module for load-more, filtering, selection, send scheduling, and optimistic updates.
- `src/components/Drafts/DraftsTab.tsx`: render adapter over the Draft queue controller.
- `src/lib/profileSetup.ts`: shared client Profile setup/readiness and local/server reconciliation helpers.
- `src/App.tsx`, `src/components/Settings/SettingsPage.tsx`, `src/components/Onboarding/OnboardingScreen.tsx`: UI adapters over `profileSetup.ts`.
- `src/lib/workspaceConfig.ts`: deeper Workspace config module with defaults, normalization, setup readiness, and attachment-library derivation.
- `server/lib/workspace-config.ts`: server Workspace config validation/normalization equivalent for persisted JSON.
- `server/lib/audience-pool.ts`: Campaign audience pool module for count, random sample, and next Batch candidate selection.
- `server/routes/audience-query.ts`, `server/lib/company-selection.ts`, `server/lib/batch.ts`: adapters over `audience-pool.ts`.

## Task 1: Email Cache Module

**Files:**
- Create: `server/lib/email-cache.ts`
- Modify: `server/routes/emails.ts`
- Modify: `server/lib/send-draft.ts`
- Test: `server/__tests__/email-cache.test.ts`
- Test: `server/__tests__/send-draft.test.ts`

- [ ] **Step 1: Write failing cache tests**

Add tests proving `invalidateEmailDashboardCache(userId)` removes `userId:global` and `userId:campaign:*`, and proving `sendDraft()` calls it after a successful Gmail send.

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run server/__tests__/email-cache.test.ts server/__tests__/send-draft.test.ts`

Expected: `email-cache.test.ts` fails because `server/lib/email-cache.ts` does not exist, or `send-draft.test.ts` fails because `sendDraft()` does not clear prefixed cache keys.

- [ ] **Step 3: Implement the cache module**

Move the `__dashCache` declaration, cache key creation, TTL read/write, eviction, and prefix invalidation into `server/lib/email-cache.ts`. Replace route-local and delivery-local invalidation with calls to the shared module.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run server/__tests__/email-cache.test.ts server/__tests__/send-draft.test.ts server/__tests__/emails-route.test.ts`

Expected: all pass.

## Task 2: Email Query Module

**Files:**
- Create: `server/lib/email-query.ts`
- Modify: `server/routes/emails.ts`
- Test: `server/__tests__/email-query.test.ts`
- Test: `server/__tests__/emails-route.test.ts`

- [ ] **Step 1: Write failing query tests**

Add tests for these Email queue read behaviors: sent-today count includes Lead and Custom Contact recipients; campaign-scoped combined reads exclude Custom Contact drafts; global combined reads merge Lead and Custom Contact Drafts/Sent by `createdAt`; cursor reads preserve the existing `nextCursor` contract.

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run server/__tests__/email-query.test.ts`

Expected: fails because the module does not exist.

- [ ] **Step 3: Move read implementation behind `email-query.ts`**

Create exported functions such as `countSentToday(userId)`, `listEmails(userId, params)`, and `readDashboardEmails(userId, params)`. Keep Prisma include shapes and custom-contact campaign exclusion identical to current behavior.

- [ ] **Step 4: Thin `server/routes/emails.ts`**

Route should parse auth/methods and call Email query/write functions. It should not own dashboard cache details.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run server/__tests__/email-query.test.ts server/__tests__/emails-route.test.ts`

Expected: all pass.

## Task 3: Draft Queue Client Module

**Files:**
- Create: `src/lib/draftQueue.ts`
- Create: `src/hooks/useDraftQueueController.ts`
- Modify: `src/components/Drafts/DraftsTab.tsx`
- Test: `server/__tests__/draft-queue-client.test.ts`

- [ ] **Step 1: Write failing pure helper tests**

Cover `stripDraftHtml`, `draftReadiness`, recipient/company derivation, filtering, sorting, and next-review selection using realistic Lead and Custom Contact Draft shapes.

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run server/__tests__/draft-queue-client.test.ts`

Expected: fails because `src/lib/draftQueue.ts` does not exist.

- [ ] **Step 3: Extract pure Draft queue helpers**

Move pure functions out of `DraftsTab.tsx` without changing behavior. Keep display strings stable because UI tests and toasts depend on them.

- [ ] **Step 4: Extract interaction controller**

Move load-more, selection, edit save, send scheduling, test send, and delete orchestration into `useDraftQueueController.ts`. Keep rendering in `DraftsTab.tsx`.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run server/__tests__/draft-queue-client.test.ts && npx vitest run server/__tests__/emails-route.test.ts server/__tests__/send-draft.test.ts`

Expected: all pass.

## Task 4: Profile Setup Module

**Files:**
- Create: `src/lib/profileSetup.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Settings/SettingsPage.tsx`
- Modify: `src/components/Onboarding/OnboardingScreen.tsx`
- Test: `server/__tests__/profile-setup-client.test.ts`

- [ ] **Step 1: Write failing readiness tests**

Cover setup readiness from Profile fields, Gmail connection state, onboarding completion gates, OAuth callback handling, and the Settings tab status mapping. Include current architectural decisions: Settings has exactly Profile / Sending / Account; Style and Integrations are retired; Gmail Connect lives in the Account tab.

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run server/__tests__/profile-setup-client.test.ts`

Expected: fails because `src/lib/profileSetup.ts` does not exist, and may expose current Settings/Profile drift.

- [ ] **Step 3: Implement Profile setup helpers**

Move `hasRecoverableCompletedSetup`, local/server reconciliation decisions, OAuth result parsing, setup section status, and Settings tab metadata into `profileSetup.ts`.

- [ ] **Step 4: Adapt App, Settings, and Onboarding**

Use the helper module for decisions. Keep current storage keys unless a failing test proves a bug.

- [ ] **Step 5: Run focused and e2e Settings tests**

Run: `npx vitest run server/__tests__/profile-setup-client.test.ts server/__tests__/profile-route.test.ts`

Run: `npx playwright test tests/e2e/gmail-connect.spec.ts tests/e2e/smoke.spec.ts`

Expected: all pass.

## Task 5: Workspace Config Module

**Files:**
- Modify: `src/lib/workspaceConfig.ts`
- Modify: `server/lib/workspace-config.ts`
- Modify: `src/lib/attachments.ts`
- Modify: `server/lib/send-draft.ts`
- Test: `server/__tests__/workspace-config-client.test.ts`
- Test: `server/__tests__/workspace-config-server.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Cover defaults, stale Template IDs, resume fallback, sending limit normalization, attachment library derivation, and API-key stripping.

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run server/__tests__/workspace-config-client.test.ts server/__tests__/workspace-config-server.test.ts`

Expected: server test fails until normalization exists.

- [ ] **Step 3: Deepen client and server Workspace config modules**

Make both modules responsible for typed parsing and safe defaults. Replace ad hoc file-library and send-limit logic with module functions.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run server/__tests__/workspace-config-client.test.ts server/__tests__/workspace-config-server.test.ts server/__tests__/send-draft.test.ts server/__tests__/profile-route.test.ts`

Expected: all pass.

## Task 6: Campaign Audience Pool Module

**Files:**
- Create: `server/lib/audience-pool.ts`
- Modify: `server/routes/audience-query.ts`
- Modify: `server/lib/company-selection.ts`
- Modify: `server/lib/batch.ts`
- Test: `server/__tests__/audience-pool.test.ts`
- Test: `server/__tests__/audience-query-route.test.ts`
- Test: `server/__tests__/campaign-batch-service.test.ts`

- [ ] **Step 1: Write failing audience pool tests**

Cover count/sample with saved Lead exclusion, small-pool shuffle, large-pool random offsets, unseen candidate selection, already-in-campaign exclusion, and exhausted-pool fallback.

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run server/__tests__/audience-pool.test.ts`

Expected: fails because `server/lib/audience-pool.ts` does not exist.

- [ ] **Step 3: Implement audience pool**

Move preview count/sample and Batch candidate selection behind one module that consumes `Audience` or Campaign filter fields and delegates where-clause construction to `audience-query.ts`.

- [ ] **Step 4: Adapt routes and Batch**

Keep route response shapes stable: `{ count, sample }` and `{ selectedIds, usingFallback }`.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run server/__tests__/audience-pool.test.ts server/__tests__/audience-query-route.test.ts server/__tests__/campaign-batch-service.test.ts server/__tests__/batch-generate-lock.test.ts`

Expected: all pass.

## Task 7: Full Verification

**Files:**
- No production edits unless verification exposes a bug.

- [ ] **Step 1: Typecheck**

Run: `npm run check`

Expected: no TypeScript errors.

- [ ] **Step 2: Unit tests**

Run: `npx vitest run`

Expected: all unit tests pass.

- [ ] **Step 3: End-to-end tests**

Run: `npx playwright test`

Expected: all e2e tests pass.

- [ ] **Step 4: Review architecture docs**

Update `CONTEXT.md` only if a new domain term was introduced. Add an ADR only if a rejected refactor has a durable reason future agents should know.
