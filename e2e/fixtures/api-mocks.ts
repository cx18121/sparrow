import type { Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// ─── Local Supabase constants (read from .env.test.local) ────────────────────

export const LOCAL_SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'

export const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? ''

const SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_KEY ?? ''

// localStorage key derived from the Supabase URL hostname
const STORAGE_KEY = `sb-${new URL(LOCAL_SUPABASE_URL).hostname}-auth-token`

// Module-level token set by signInDemo — safe with workers:1 (serial tests).
// createTestCampaign / createTestTemplate read this automatically.
let _accessToken: string | null = null

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
 * endpoint directly, then seeds the real session into the browser's
 * localStorage so the Supabase JS client picks it up without a redirect.
 *
 * Also marks onboarding as complete so tests start on the dashboard.
 *
 * Call this BEFORE page.goto().
 */
export async function signInDemo(page: Page): Promise<{ session: any; userId: string }> {
  // Get a real JWT from local Supabase.
  const resp = await page.request.post(
    `${LOCAL_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: {
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
      data: { email: 'e2e@sparrow.test', password: 'SparrowE2E2024!' },
    },
  )

  if (!resp.ok()) {
    throw new Error(`[signInDemo] Auth failed: ${resp.status()} ${await resp.text()}`)
  }

  const session = await resp.json()
  const userId: string = session.user.id

  // Seed session + onboarding flag into localStorage before page JS runs.
  await page.addInitScript(
    ({ session, storageKey, userId }: { session: any; storageKey: string; userId: string }) => {
      localStorage.setItem(storageKey, JSON.stringify(session))

      const now = new Date().toISOString()
      localStorage.setItem(
        `cf_onboarding_${userId}`,
        JSON.stringify({
          completed: true,
          completedAt: now,
          updatedAt: now,
          data: {
            senderName: 'E2E Test User',
            styleProfile: { examples: ['hi'] },
          },
        }),
      )
    },
    { session, storageKey: STORAGE_KEY, userId },
  )

  // Store token for use by createTestCampaign / createTestTemplate.
  _accessToken = session.access_token

  return { session, userId }
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

/**
 * Creates a campaign by POSTing to the real API and returns the created object.
 */
export async function createTestCampaign(page: Page, overrides: Record<string, unknown> = {}) {
  const resp = await page.request.post('/api/campaigns', {
    headers: { Authorization: `Bearer ${_accessToken}` },
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
export async function createTestTemplate(page: Page, overrides: Record<string, unknown> = {}) {
  const resp = await page.request.post('/api/templates', {
    headers: { Authorization: `Bearer ${_accessToken}` },
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
