import { test, expect, type Route } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestCampaign,
  createTestTemplate,
  cleanupTestData,
  SAMPLE_COMPANY,
} from './fixtures/api-mocks'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

// A sample lead shape for the campaign-leads response (no DB row needed).
const SAMPLE_LEAD_STUB = {
  id: 'lead_overview_1',
  userId: 'demo',
  companyId: SAMPLE_COMPANY.id,
  contactId: null,
  apolloPersonId: null,
  status: 'SAVED',
  notes: null,
  addedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  company: SAMPLE_COMPANY,
  contact: null,
  emails: [],
}

let userId: string
let campaignId: string

test.describe('Campaign overview UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    const template = await createTestTemplate(page, { name: 'Overview template' })
    const campaign = await createTestCampaign(page, {
      name: 'Overview UX campaign',
      status: 'ACTIVE',
      templateId: template.id,
    })
    campaignId = campaign.id
    await mockApi(page, {
      companiesResponse: {
        items: [SAMPLE_COMPANY],
        nextCursor: null,
        seenTotal: 0,
        usingFallback: false,
      },
    })
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('shows counts and routes CTA to Drafts when leads exist but no drafts are ready', async ({
    page,
  }) => {
    await page.route('**/api/campaign-leads**', route =>
      json(route, { items: [SAMPLE_LEAD_STUB] }),
    )
    await page.route('**/api/emails?combined=true**', route =>
      json(route, { drafts: [], sent: [] }),
    )

    await page.goto(`/campaigns/${campaignId}/overview`)

    await expect(
      page.locator('text=/1 lead saved\\. Generate drafts\\./i'),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /Leads\s+1/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Drafts\s+0/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Sent\s+0/i })).toBeVisible()

    await page.getByRole('button', { name: /Go to Drafts/i }).click()
    await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/drafts`))
  })

  test('routes the stats strip to the matching workspace tabs', async ({ page }) => {
    await page.route('**/api/campaign-leads**', route =>
      json(route, { items: [SAMPLE_LEAD_STUB] }),
    )
    await page.route('**/api/emails?combined=true**', route =>
      json(route, {
        drafts: [{ id: 'email_draft_1', subject: 'Draft', status: 'draft' }],
        sent: [{ id: 'email_sent_1', subject: 'Sent', status: 'sent' }],
      }),
    )

    await page.goto(`/campaigns/${campaignId}/overview`)
    await expect(page.locator('text=/1 draft ready to review/i')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /Sent\s+1/i }).click()
    await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/sent`))
  })
})
