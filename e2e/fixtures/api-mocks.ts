import type { Page, Route } from '@playwright/test'

// Centralised API mocks for smoke tests. Each test can override individual
// routes before navigating; this file provides the empty-but-valid baseline.

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
}

export async function mockApi(page: Page, opts: MockOptions = {}) {
  const {
    campaigns = [], leads = [], customContacts = [], templates = [],
    companies = [], drafts = [], sent = [],
  } = opts

  // Profile is needed for App.tsx onboarding gate
  await page.route('**/api/profile', route =>
    json(route, {
      profile: {
        onboardingCompleted: true,
        workspaceConfig: { senderName: 'Demo User', templateId: null },
        hasClaudeKey: true,
        hasGoogleRefreshToken: true,
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
  await page.route('**/api/industries', route => json(route, { items: [] }))
}
