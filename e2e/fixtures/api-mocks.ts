import type { Page, Route } from '@playwright/test'

// Centralised API mocks for smoke tests. Each test can override individual
// routes before navigating; this file provides the empty-but-valid baseline.

export const DEMO_USER_ID = 'demo-user-id'

/**
 * Seeds a fake but structurally correct Supabase auth session in localStorage
 * so the app's AuthContext resolves the user without hitting real Supabase.
 * Also mocks the Supabase auth network endpoints so token-refresh and /user
 * calls don't fail.
 *
 * Call this BEFORE page.goto() (use it in addInitScript + route mocks).
 */
export async function signInDemo(page: Page) {
  // Mock Supabase auth network calls BEFORE the page loads so any eager
  // token-refresh or /user fetch is intercepted immediately.
  await page.route('**/auth/v1/**', route => {
    const url = route.request().url()
    const method = route.request().method()

    // Build the fake token inline so we can reuse it here too.
    function b64url(obj: object) {
      return btoa(JSON.stringify(obj))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')
    }
    const header = b64url({ alg: 'HS256', typ: 'JWT' })
    const payload = b64url({
      sub: DEMO_USER_ID,
      email: 'demo@test.local',
      role: 'authenticated',
      aud: 'authenticated',
      iss: 'supabase',
      iat: 1000000000,
      exp: 9999999999,
    })
    const token = `${header}.${payload}.fakesig`

    const user = {
      id: DEMO_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'demo@test.local',
      user_metadata: { full_name: 'Demo User', avatar_url: null },
      app_metadata: {},
      created_at: '2024-01-01T00:00:00.000Z',
    }

    const session = {
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 9999999999,
      refresh_token: 'fake-refresh',
      user,
    }

    // GET /auth/v1/user — return user object
    if (method === 'GET' && url.includes('/user')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(user),
      })
    }

    // POST /auth/v1/token (token refresh) — return full session
    if (method === 'POST' && url.includes('/token')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(session),
      })
    }

    // POST /auth/v1/authorize — return OAuth error so tests can assert the error UI
    if (url.includes('/authorize')) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'oauth_error',
          error_description: 'OAuth provider unavailable in test mode',
        }),
      })
    }

    // Default: pass through with empty 200 for any other auth endpoint
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  // Seed localStorage before the page JS runs.
  await page.addInitScript((userId: string) => {
    function b64url(obj: object) {
      return btoa(JSON.stringify(obj))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')
    }
    const header = b64url({ alg: 'HS256', typ: 'JWT' })
    const payload = b64url({
      sub: userId,
      email: 'demo@test.local',
      role: 'authenticated',
      aud: 'authenticated',
      iss: 'supabase',
      iat: 1000000000,
      exp: 9999999999,
    })
    const token = `${header}.${payload}.fakesig`

    const user = {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'demo@test.local',
      user_metadata: { full_name: 'Demo User', avatar_url: null },
      app_metadata: {},
      created_at: '2024-01-01T00:00:00.000Z',
    }

    const session = {
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 9999999999,
      refresh_token: 'fake-refresh',
      user,
    }

    // Supabase stores auth under sb-<project-ref>-auth-token
    localStorage.setItem('sb-fivmzkrwnvfyhjbltbmv-auth-token', JSON.stringify(session))

    // Onboarding state: mark complete so tests skip the wizard
    const now = new Date().toISOString()
    localStorage.setItem(`cf_onboarding_${userId}`, JSON.stringify({
      completed: true,
      completedAt: now,
      updatedAt: now,
      data: {
        senderName: 'Demo User',
        styleProfile: { examples: ['hi'] },
      },
    }))
  }, DEMO_USER_ID)
}

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

export const SAMPLE_LEAD = {
  id: 'lead_1',
  userId: 'demo',
  companyId: SAMPLE_COMPANY.id,
  contactId: 'contact_1',
  apolloPersonId: null,
  status: 'SAVED',
  notes: null,
  addedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  company: SAMPLE_COMPANY,
  contact: { id: 'contact_1', name: 'Avery Kim', email: 'avery@acme.test', title: 'Founder', role: 'founder' },
  emails: [],
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

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

interface MockOptions {
  campaigns?: any[]
  leads?: any[]
  customContacts?: any[]
  templates?: any[]
  companies?: any[]
  drafts?: any[]
  sent?: any[]
  profile?: Partial<{
    hasClaudeKey: boolean
    hasGoogleRefreshToken: boolean
  }>
}

export async function mockApi(page: Page, opts: MockOptions = {}) {
  const {
    campaigns = [], leads = [], customContacts = [], templates = [],
    companies = [], drafts = [], sent = [],
    profile: profileOverrides = {},
  } = opts

  // Profile is needed for App.tsx onboarding gate
  await page.route('**/api/profile', route =>
    json(route, {
      profile: {
        onboardingCompleted: true,
        workspaceConfig: { senderName: 'Demo User', templateId: null },
        hasClaudeKey: true,
        hasGoogleRefreshToken: true,
        ...profileOverrides,
      },
    })
  )

  await page.route('**/api/templates', route => json(route, { items: templates }))
  await page.route('**/api/campaigns**', route => {
    if (route.request().method() === 'POST') {
      // Echo back a created campaign
      return json(route, { id: 'cmp_new', userId: 'demo', name: 'New', status: 'DRAFT', batchSize: 10, currentBatch: 0, filterTags: [], attachmentIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    }
    return json(route, { items: campaigns })
  })
  await page.route('**/api/leads**', route => json(route, { items: leads }))
  await page.route('**/api/custom-contacts**', route => json(route, { items: customContacts }))
  await page.route('**/api/companies**', route =>
    json(route, { items: companies, nextCursor: null, seenTotal: 0, usingFallback: false })
  )
  await page.route('**/api/campaign-options', route =>
    json(route, { industries: [], regions: [], stages: [], batches: [], tags: {}, hiringCount: 0 })
  )
  await page.route('**/api/audience-query', route =>
    json(route, { count: 84, sample: ['Acme Robotics', 'Helio Labs', 'Latch Systems'] })
  )
  await page.route('**/api/emails?combined=true**', route => json(route, { drafts, sent }))
  await page.route('**/api/emails?countToday=true**', route => json(route, { count: 0 }))
  await page.route('**/api/emails**', route => json(route, { items: [...drafts, ...sent] }))
  await page.route('**/api/account', route => json(route, { success: true }))
}
