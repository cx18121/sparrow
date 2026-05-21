import type { Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// ─── Local Supabase constants (read from .env.test.local) ────────────────────

export const LOCAL_SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'

export const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? ''

const SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_KEY ?? ''

// Module-level token set by signInDemo — safe with workers:1 (serial tests).
// createTestCampaign / createTestTemplate read this automatically.
// Call clearAccessToken() in afterEach if you want explicit reset between tests.
let _accessToken: string | null = null

export function clearAccessToken() {
  _accessToken = null
}

// ─── Reference objects for assertions (not for mocking) ──────────────────────

export const SAMPLE_COMPANY = {
  id: 'co_1',
  name: 'Acme Robotics',
  domain: 'acme.test',
  oneLiner: 'Robots that fold laundry',
  website: 'https://acme.test',
  industry: 'Hardware',
  region: 'us',
  stage: 'Seed',
  batch: 'W26',
  isHiring: true,
  location: 'San Francisco',
}

export const SAMPLE_TEMPLATE = {
  id: 'tpl_1',
  userId: 'demo',
  name: 'Cold intro',
  subject: 'Quick question about {{company}}',
  body: '<p>Hi {{first_name}},</p>',
  isShared: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

// ─── Real sign-in ─────────────────────────────────────────────────────────────

/**
 * Authenticates as the e2e test user by calling the local Supabase auth
 * Signs in via the real auth form, yielding a genuine Supabase session.
 * Onboarding is bypassed by intercepting localStorage.getItem so the app
 * always sees onboarding as complete (userId is unknown until after sign-in).
 *
 * Call this BEFORE page.goto() — it navigates to /dashboard to do the sign-in.
 */
export async function signInDemo(page: Page): Promise<{ session: any; userId: string }> {
  // Intercept localStorage.getItem so every cf_onboarding_* key returns
  // "completed" regardless of actual storage state. This bypasses the
  // onboarding wizard without needing the userId in advance.
  await page.addInitScript(() => {
    const origGetItem = localStorage.getItem.bind(localStorage)
    localStorage.getItem = (key: string) => {
      if (key.startsWith('cf_onboarding_')) {
        return JSON.stringify({
          completed: true,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          data: { senderName: 'E2E Test User', styleProfile: { examples: ['hi'] } },
        })
      }
      return origGetItem(key)
    }
  })

  // Get a real token via the Supabase password endpoint (for API calls).
  const tokenResp = await page.request.post(
    `${LOCAL_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: 'e2e@sparrow.test', password: 'SparrowE2E2024!' },
    },
  )
  if (!tokenResp.ok()) {
    throw new Error(`[signInDemo] Token fetch failed: ${tokenResp.status()} ${await tokenResp.text()}`)
  }
  const tokenData = await tokenResp.json()
  const userId: string = tokenData.user.id

  // Navigate to the auth screen and sign in via the real form.
  await page.goto('/dashboard')
  await page.getByPlaceholder('you@example.com').fill('e2e@sparrow.test')
  await page.getByPlaceholder('••••••••').fill('SparrowE2E2024!')
  await page.getByRole('button', { name: /^Sign in$/i }).click()

  // Wait for the auth heading to disappear — sign-in completed.
  await page.waitForSelector('h2:has-text("Welcome back")', { state: 'detached', timeout: 15_000 })

  const session = { ...tokenData, user: tokenData.user }

  if (!session?.user?.id) {
    throw new Error('[signInDemo] Session not found after sign-in')
  }

  // Store token for use by createTestCampaign / createTestTemplate.
  _accessToken = session.access_token
  console.log('[signInDemo] _accessToken set:', _accessToken ? `${_accessToken.substring(0, 20)}...` : 'NULL')

  return { session, userId: session.user.id }
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

/**
 * Creates a campaign by POSTing to the real API and returns the created object.
 */
export async function createTestCampaign(page: Page, overrides: Record<string, unknown> = {}, token?: string) {
  const tok = token ?? _accessToken
  if (!tok) console.error('[createTestCampaign] no access token — call signInDemo first')
  const resp = await page.request.post('/api/campaigns', {
    headers: { Authorization: `Bearer ${tok}` },
    data: { name: 'Test Campaign', status: 'ACTIVE', ...overrides },
  })
  if (!resp.ok()) {
    throw new Error(`[createTestCampaign] Failed: ${resp.status()} ${await resp.text()}`)
  }
  return resp.json()
}

/**
 * Creates a template by POSTing to the real API and returns the created object.
 */
export async function createTestTemplate(page: Page, overrides: Record<string, unknown> = {}, token?: string) {
  const tok = token ?? _accessToken
  if (!tok) console.error('[createTestTemplate] no access token — call signInDemo first')
  const resp = await page.request.post('/api/templates', {
    headers: { Authorization: `Bearer ${tok}` },
    data: {
      name: 'Test Template',
      subject: 'Test Subject',
      body: '<p>Test body</p>',
      ...overrides,
    },
  })
  if (!resp.ok()) {
    throw new Error(`[createTestTemplate] Failed: ${resp.status()} ${await resp.text()}`)
  }
  return resp.json()
}

// ─── Direct DB seeding (admin Supabase client, bypasses API auth) ────────────

// Domain prefix that marks a Company row as test-owned. Cleanup uses this to
// delete only e2e Companies, leaving production-style rows alone if any are
// in the local DB.
const E2E_COMPANY_DOMAIN_PREFIX = 'e2e-'

// Generates a cuid-shaped id locally. Direct REST inserts via the Supabase
// admin client bypass Prisma's @default(cuid()) behavior, so we have to
// emit the id ourselves. Shape doesn't have to be a real cuid — it just
// needs to be a unique string that Prisma will accept as a String @id.
function localCuid(prefix = 'c'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Seeds a verbatim Email row + its Company (with role-shaped envelope
 * dossier) + UserLead linking them to the user. Bypasses the
 * /api/emails/generate path so we can pin exactly which role columns are
 * populated — necessary for testing the AnglePicker (which discriminates
 * role from the populated column) and the partial-personalization warning
 * (which fires when one half of the role's pair is null).
 *
 * Returns { emailId, companyId, userLeadId }. Cleanup is handled by
 * cleanupTestData (deletes the Company by its e2e-prefixed domain).
 */
export interface SeedDraftOptions {
  userId: string
  role: 'eng' | 'gtm' | 'ops'
  // Which half of the role's (company-side, candidate-side) pair to leave
  // null. `both` populates both (fully personalized — no warning fires).
  // `candidate` is the most common partial-failure case (picker emitted the
  // company-side line but not the candidate side).
  partial?: 'company' | 'candidate' | 'both'
  companyName?: string
  // Body should reference the role's merge tags. The seed substitutes the
  // values that are non-null so the rendered body matches what the server
  // would have shipped post-dropEmptyTagParagraphs.
  bodyTemplate?: string
  // Optional campaign to attach this draft to via CampaignLead. Required
  // for tests that navigate to /campaigns/:id/drafts — the workspace
  // queries filter by campaignLeads.some({ campaignId }).
  campaignId?: string
}

export interface SeededDraft {
  emailId: string
  companyId: string
  userLeadId: string
}

export async function createTestDraft(
  page: Page,
  opts: SeedDraftOptions,
): Promise<SeededDraft> {
  const admin = createClient(LOCAL_SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const partial = opts.partial ?? 'both'
  const companyName = opts.companyName ?? 'Acme E2E'
  // Per-test unique domain so seeded Companies don't collide across tests.
  const domain = `${E2E_COMPANY_DOMAIN_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}.test`

  // Envelope dossier per ADR-0005. Both gtm and operations slots populated
  // so the picker has options regardless of which role we test against. Eng
  // surfaces are also included for the eng path.
  const now = new Date().toISOString()
  const researchDossier = {
    engineering: {
      researchedAt: now,
      dossier: {
        summary: 'Eng dossier',
        surfaces: ['the inference cost optimizer', 'the model router', 'per-tenant cost dashboards'],
        recentLaunches: [],
        technicalAreas: ['multi-model routing'],
      },
    },
    gtm: {
      researchedAt: now,
      dossier: {
        summary: 'Series B GTM ramp',
        triggers: ['raised Series B in March', 'hired VP Sales from Stripe'],
        recentMoves: ['expanded to EMEA'],
        marketSignals: ['category leader in dev-tool sales'],
      },
    },
    operations: {
      researchedAt: now,
      dossier: {
        summary: 'Scaling past 200 employees',
        inflections: ['Series D + AI agent launches', 'new EMEA office opening'],
        recentHires: ['new VP Engineering'],
        openRoles: ['Head of People'],
      },
    },
  }

  const companyId = localCuid('co_')
  const { error: companyErr } = await admin
    .from('Company')
    .insert({
      id: companyId,
      name: companyName,
      domain,
      source: 'e2e',
      isVerified: true,
      researchDossier,
      researchedAt: now,
      updatedAt: now,
    })
  if (companyErr) throw new Error(`[createTestDraft] Company insert failed: ${companyErr.message}`)

  const userLeadId = localCuid('ul_')
  const { error: leadErr } = await admin
    .from('UserLead')
    .insert({ id: userLeadId, userId: opts.userId, companyId, status: 'SAVED', updatedAt: now })
  if (leadErr) throw new Error(`[createTestDraft] UserLead insert failed: ${leadErr.message}`)

  // Attach the lead to a campaign so the workspace drafts query
  // (filters by campaignLeads.some) returns this draft.
  if (opts.campaignId) {
    // CampaignLead has no updatedAt — only createdAt (auto via @default(now())).
    const { error: clErr } = await admin
      .from('CampaignLead')
      .insert({ id: localCuid('cl_'), campaignId: opts.campaignId, userLeadId })
    if (clErr) throw new Error(`[createTestDraft] CampaignLead insert failed: ${clErr.message}`)
  }

  // Compute role-specific column values and a rendered body. Per
  // dropEmptyTagParagraphs in server/lib/ai/generate-email.ts, any
  // paragraph anchored on a null tag is removed before persistence — so
  // the seed mirrors that by including only paragraphs whose tags are
  // non-null.
  const companyHalfFilled = partial !== 'company'
  const candidateHalfFilled = partial !== 'candidate'
  let role: Record<string, string | null> = {}
  let bodyParas: string[] = []
  const subject = `Quick note on ${companyName}`

  if (opts.role === 'eng') {
    const feature = companyHalfFilled ? 'the inference cost optimizer' : null
    const fit = candidateHalfFilled ? 'my background' : null
    role = { featureLine: feature, fitAngle: fit, gtmTriggerLine: null, gtmProofOfMotion: null, opsInflectionLine: null, opsSystemBuilt: null }
    if (feature) bodyParas.push(`<p>Saw ${companyName} just shipped ${feature}.</p>`)
    if (fit) bodyParas.push(`<p>For context, ${fit} feels like a stepping stone.</p>`)
  } else if (opts.role === 'gtm') {
    const trigger = companyHalfFilled ? 'raised Series B in March' : null
    const proof = candidateHalfFilled ? 'my mid-market AE work' : null
    role = { featureLine: null, fitAngle: null, gtmTriggerLine: trigger, gtmProofOfMotion: proof, opsInflectionLine: null, opsSystemBuilt: null }
    if (trigger) bodyParas.push(`<p>Caught the news on ${trigger}.</p>`)
    if (proof) bodyParas.push(`<p>For context, ${proof} is the closest analog.</p>`)
  } else {
    const inflection = companyHalfFilled ? 'Series D + AI agent launches' : null
    const system = candidateHalfFilled ? 'my Chief of Staff role' : null
    role = { featureLine: null, fitAngle: null, gtmTriggerLine: null, gtmProofOfMotion: null, opsInflectionLine: inflection, opsSystemBuilt: system }
    if (inflection) bodyParas.push(`<p>Noticed ${inflection}.</p>`)
    if (system) bodyParas.push(`<p>For context, ${system} is the closest analog.</p>`)
  }
  const body = opts.bodyTemplate ?? bodyParas.join('')

  const emailId = localCuid('em_')
  const { error: emailErr } = await admin
    .from('Email')
    .insert({
      id: emailId,
      userLeadId,
      subject,
      body,
      status: 'draft',
      attachmentIds: [],
      generationKind: 'verbatim',
      updatedAt: now,
      ...role,
    })
  if (emailErr) throw new Error(`[createTestDraft] Email insert failed: ${emailErr.message}`)

  return { emailId, companyId, userLeadId }
}

/**
 * Deletes all data rows owned by the e2e user directly via the Supabase admin
 * client. Prisma table names (camelCase) map to the DB names used below.
 *
 * Dependency order: Email → CampaignLead / CampaignCustomContact → Campaign
 *                   Email → UserLead → (nothing)
 *                   CustomContact → CampaignCustomContact (already cascaded)
 */
export async function cleanupTestData(userId: string) {
  const admin = createClient(LOCAL_SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 1. Delete emails attached to this user's leads (via userLeadId join)
  //    and emails attached to this user's custom contacts.
  //    Easiest: delete by userId via the UserLead / CustomContact join.
  //    Since Email has no direct userId, we delete campaigns first to trigger
  //    cascades where possible, then mop up orphans.

  // Delete CampaignLead rows (cascade from Campaign onDelete:Cascade already
  // fires in Prisma, but we do it explicitly here for safety).
  await admin.from('CampaignLead').delete().in(
    'campaignId',
    // Sub-select all campaign IDs for this user
    (await admin.from('Campaign').select('id').eq('userId', userId)).data?.map((r: any) => r.id) ?? [],
  )

  // Delete CampaignCustomContact rows.
  await admin.from('CampaignCustomContact').delete().in(
    'campaignId',
    (await admin.from('Campaign').select('id').eq('userId', userId)).data?.map((r: any) => r.id) ?? [],
  )

  // Delete Campaigns (onDelete:Cascade will also remove CampaignLead/
  // CampaignCustomContact/CampaignSeenCompany children).
  await admin.from('Campaign').delete().eq('userId', userId)

  // Delete Email rows tied to this user's UserLeads.
  const userLeadIds =
    (await admin.from('UserLead').select('id').eq('userId', userId)).data?.map((r: any) => r.id) ?? []
  if (userLeadIds.length > 0) {
    await admin.from('Email').delete().in('userLeadId', userLeadIds)
  }

  // Delete Email rows tied to this user's CustomContacts.
  const ccIds =
    (await admin.from('CustomContact').select('id').eq('userId', userId)).data?.map(
      (r: any) => r.id,
    ) ?? []
  if (ccIds.length > 0) {
    await admin.from('Email').delete().in('customContactId', ccIds)
  }

  // Delete UserLead rows.
  await admin.from('UserLead').delete().eq('userId', userId)

  // Delete CustomContact rows.
  await admin.from('CustomContact').delete().eq('userId', userId)

  // Delete Template rows.
  await admin.from('Template').delete().eq('userId', userId)

  // Delete DiscoverySeen rows.
  await admin.from('DiscoverySeenCompany').delete().eq('userId', userId)

  // Delete IdempotencyKey rows.
  await admin.from('IdempotencyKey').delete().eq('userId', userId)

  // Delete DailyQuota rows keyed to this user.
  await admin.from('DailyQuota').delete().eq('subjectId', userId)

  // Delete UserGmailWatch row.
  await admin.from('UserGmailWatch').delete().eq('userId', userId)

  // Delete user_profiles row (auth-adjacent, managed outside Prisma).
  await admin.from('user_profiles').delete().eq('user_id', userId)

  // Delete e2e-seeded Companies. Companies have no userId (they're shared
  // across users in production), so we identify test rows by the
  // E2E_COMPANY_DOMAIN_PREFIX domain pattern that createTestDraft uses.
  // Order matters: child rows (UserLead/Email/Contact) referencing these
  // Companies are deleted above by userId; what's left after that are
  // orphaned Companies, safe to remove.
  await admin.from('Company').delete().like('domain', `${E2E_COMPANY_DOMAIN_PREFIX}%`)
}

// ─── External-service mocks only ─────────────────────────────────────────────

/**
 * Registers page.route() mocks for external services that we never want to
 * actually call in e2e tests (Apollo, Claude, Gmail OAuth, Google OAuth).
 *
 * Real internal API routes (/api/campaigns, /api/templates, /api/profile,
 * /api/leads, /api/campaign-leads, /api/custom-contacts, /api/campaign-options)
 * are NOT mocked — they hit the real local API server and Postgres.
 */
export async function mockApi(
  page: Page,
  opts: {
    companiesResponse?: any
    audienceQueryResponse?: any
    draftResponse?: any
  } = {},
) {
  // Apollo-powered company discovery
  await page.route('**/api/companies**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        opts.companiesResponse ?? {
          items: [],
          nextCursor: null,
          seenTotal: 0,
          usingFallback: false,
        },
      ),
    }),
  )

  await page.route('**/api/audience-query**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.audienceQueryResponse ?? { count: 0, sample: [] }),
    }),
  )

  // Claude-powered draft generation
  await page.route('**/api/emails/generate**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        opts.draftResponse ?? {
          emailId: 'draft-1',
          subject: 'Test subject',
          body: '<p>Test body</p>',
        },
      ),
    }),
  )

  // Gmail send
  await page.route('**/api/emails/send**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    }),
  )

  await page.route('**/api/emails/send-test**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    }),
  )

  // Google OAuth
  await page.route('**/api/google/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: null, error: 'OAuth not available in test mode' }),
    }),
  )
}
