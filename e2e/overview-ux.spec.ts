import { test, expect, type Page, type Route } from '@playwright/test'
import { mockApi, signInDemo, SAMPLE_COMPANY, SAMPLE_LEAD, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

const CAMPAIGN_ID = 'cmp_overview_ux'
const CAMPAIGN = {
  id: CAMPAIGN_ID,
  userId: 'demo',
  name: 'Overview UX campaign',
  subject: 'Quick question',
  status: 'ACTIVE' as const,
  templateId: SAMPLE_TEMPLATE.id,
  filterTags: ['stage:seed'],
  filterRegion: '__US__',
  filterStage: null,
  filterBatch: null,
  filterIsHiring: null,
  filterHeadcountMin: null,
  filterHeadcountMax: null,
  batchSize: 10,
  currentBatch: 0,
  tone: null,
  attachmentIds: [],
  scheduledAt: null,
  template: { id: SAMPLE_TEMPLATE.id, name: SAMPLE_TEMPLATE.name },
  includePreviouslySaved: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

test.describe('Campaign overview UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInDemo(page)
  })

  test('shows counts and routes CTA to Drafts when leads exist but no drafts are ready', async ({ page }) => {
    await mockApi(page, { campaigns: [CAMPAIGN], templates: [SAMPLE_TEMPLATE] })
    await page.route('**/api/campaign-leads**', route => json(route, { items: [SAMPLE_LEAD] }))
    await page.route('**/api/emails?combined=true**', route => json(route, { drafts: [], sent: [] }))

    await page.goto(`/campaigns/${CAMPAIGN_ID}/overview`)

    await expect(page.locator('text=/1 lead saved\\. Generate drafts\\./i')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /Leads\s+1/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Drafts\s+0/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Sent\s+0/i })).toBeVisible()

    await page.getByRole('button', { name: /Go to Drafts/i }).click()
    await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/drafts`))
  })

  test('routes the stats strip to the matching workspace tabs', async ({ page }) => {
    await mockApi(page, { campaigns: [CAMPAIGN], templates: [SAMPLE_TEMPLATE], companies: [SAMPLE_COMPANY] })
    await page.route('**/api/campaign-leads**', route => json(route, { items: [SAMPLE_LEAD] }))
    await page.route('**/api/emails?combined=true**', route => json(route, {
      drafts: [{ id: 'email_draft_1', subject: 'Draft', status: 'draft' }],
      sent: [{ id: 'email_sent_1', subject: 'Sent', status: 'sent' }],
    }))

    await page.goto(`/campaigns/${CAMPAIGN_ID}/overview`)
    await expect(page.locator('text=/1 draft ready to review/i')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /Sent\s+1/i }).click()
    await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/sent`))
  })
})
