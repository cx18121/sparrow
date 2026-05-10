import { test, expect } from '@playwright/test'
import { mockApi, signInDemo, SAMPLE_COMPANY, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

// Contacts sub-tab — Phase F2
//   - New /campaigns/:id/contacts route exists
//   - Empty state when no leads saved to this campaign
//   - Lists saved leads with status pills
//   - "Generate draft" button calls /api/emails/generate and re-renders
//     with status flipped from "No draft" to "Draft ready"

const CAMPAIGN_ID = 'cmp_contacts_1'
const SAMPLE_CAMPAIGN = {
  id: CAMPAIGN_ID,
  userId: 'demo',
  name: 'Series A AI infra',
  subject: 'Quick question',
  status: 'ACTIVE' as const,
  templateId: SAMPLE_TEMPLATE.id,
  filterTags: [],
  filterRegion: null,
  filterStage: null,
  filterBatch: null,
  filterIsHiring: null,
  filterHeadcountMin: null,
  filterHeadcountMax: null,
  tone: null,
  attachmentIds: [],
  scheduledAt: null,
  template: { id: SAMPLE_TEMPLATE.id, name: SAMPLE_TEMPLATE.name },
  includePreviouslySaved: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const SAVED_LEAD = {
  id: 'lead_contacts_1',
  userId: 'demo',
  companyId: SAMPLE_COMPANY.id,
  contactId: 'contact_contacts_1',
  apolloPersonId: null,
  status: 'SAVED',
  notes: null,
  addedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  company: SAMPLE_COMPANY,
  contact: { id: 'contact_contacts_1', name: 'Sarah Chen', email: 'sarah@acme.test', title: 'Head of Engineering' },
  emails: [],
}

test.describe('Contacts sub-tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInDemo(page)
  })

  test('Contacts tab appears in sub-tab nav between Leads and Drafts', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })
    await page.route('**/api/campaign-leads**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
    )

    await page.goto(`/campaigns/${CAMPAIGN_ID}/overview`)
    await expect(page.getByRole('tab', { name: 'Contacts', exact: true })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('tab', { name: 'Contacts', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/contacts`))
  })

  test('renders empty state when no contacts are saved to this campaign', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })
    await page.route('**/api/campaign-leads**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
    )

    await page.goto(`/campaigns/${CAMPAIGN_ID}/contacts`)
    await expect(page.locator('text=/No saved contacts yet/i')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button', { hasText: /Find leads/i })).toBeVisible()
  })

  test('lists a saved contact with No-draft status and a Generate-draft button', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })
    await page.route('**/api/campaign-leads**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [SAVED_LEAD] }) })
    )

    await page.goto(`/campaigns/${CAMPAIGN_ID}/contacts`)
    await expect(page.locator('text=/Sarah Chen/').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=/Head of Engineering/i')).toBeVisible()
    await expect(page.locator('text=/Acme Robotics/i')).toBeVisible()
    await expect(page.locator('text=/No draft/i').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Generate draft/i })).toBeVisible()
  })

  test('Generate-draft button calls /api/emails/generate and flips status to Draft ready', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })

    // The generate-draft call flips a flag; subsequent campaign-leads fetches
    // include the new draft. This is StrictMode-safe (double-fired useEffect
    // in dev still returns the no-draft state until generate is called).
    let draftGenerated = false
    await page.route('**/api/campaign-leads**', route => {
      const lead = draftGenerated
        ? { ...SAVED_LEAD, emails: [{ id: 'em_new', subject: 'Quick', status: 'draft' }] }
        : SAVED_LEAD
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [lead] }) })
    })

    let generateCalled = false
    let generatePayload: any = null
    await page.route('**/api/emails/generate', route => {
      generateCalled = true
      generatePayload = route.request().postDataJSON()
      draftGenerated = true
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subject: 'Quick intro - Alex', body: 'Hi Sarah,', emailId: 'em_new' }),
      })
    })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/contacts`)
    await expect(page.locator('text=/Sarah Chen/').first()).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /Generate draft/i }).click()

    await expect(page.locator('text=/Draft ready/i')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('a, button', { hasText: /Open in Drafts/i }).first()).toBeVisible()

    expect(generateCalled).toBe(true)
    // Contract: campaign-scoped Generate must carry the campaign's templateId.
    // Without it the server falls into kind:'ai' and the humanizer rewrites
    // even verbatim-flagged templates.
    expect(generatePayload?.templateId).toBe(SAMPLE_TEMPLATE.id)
    expect(generatePayload?.userLeadId).toBe(SAVED_LEAD.id)
    expect(generatePayload?.save).toBe(true)
  })

  test('select-all + bulk Generate triggers /api/emails/generate per selected no-draft lead', async ({ page }) => {
    const SAVED_LEAD_2 = {
      ...SAVED_LEAD,
      id: 'lead_contacts_2',
      contactId: 'contact_contacts_2',
      contact: { id: 'contact_contacts_2', name: 'Devon Park', email: 'devon@acme.test', title: 'CTO' },
    }

    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })
    await page.route('**/api/campaign-leads**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [SAVED_LEAD, SAVED_LEAD_2] }) })
    )

    let generateCalls = 0
    const bulkPayloads: any[] = []
    await page.route('**/api/emails/generate', route => {
      generateCalls++
      bulkPayloads.push(route.request().postDataJSON())
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subject: 'Quick', body: 'Hi', emailId: `em_${generateCalls}` }),
      })
    })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/contacts`)
    await expect(page.locator('text=/Sarah Chen/').first()).toBeVisible({ timeout: 10_000 })

    await page.getByLabel('Select all').check()
    await expect(page.locator('text=/2 selected/')).toBeVisible()

    await page.getByRole('button', { name: /^Generate \(2\)$/ }).click()

    await expect.poll(() => generateCalls, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
    // Each bulk Generate call must carry the campaign's templateId (same
    // contract as the single-row path).
    for (const payload of bulkPayloads) {
      expect(payload?.templateId).toBe(SAMPLE_TEMPLATE.id)
    }
  })

  test('bulk Remove deletes selected campaign-lead links via DELETE /api/campaign-leads', async ({ page }) => {
    const LEAD_A = { ...SAVED_LEAD, campaignLeadId: 'cl_a' }
    const LEAD_B = { ...SAVED_LEAD, id: 'lead_contacts_2', campaignLeadId: 'cl_b', contact: { id: 'c2', name: 'Devon Park', title: 'CTO' } }

    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })
    let removed = false
    await page.route('**/api/campaign-leads**', route => {
      const method = route.request().method()
      if (method === 'DELETE') {
        removed = true
        return route.fulfill({ status: 204, body: '' })
      }
      const items = removed ? [LEAD_B] : [LEAD_A, LEAD_B]
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items }) })
    })
    await page.addInitScript(() => { window.confirm = () => true })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/contacts`)
    await expect(page.locator('text=/Sarah Chen/').first()).toBeVisible({ timeout: 10_000 })

    // Select first row only via the per-row checkbox (Sarah Chen).
    await page.getByLabel('Select Sarah Chen').check()
    await expect(page.locator('text=/1 selected/')).toBeVisible()

    await page.getByRole('button', { name: /^Remove$/ }).click()

    await expect.poll(() => removed, { timeout: 10_000 }).toBe(true)
    // After remove + reload, only Devon Park is left.
    await expect(page.locator('text=/Devon Park/')).toBeVisible()
    await expect(page.locator('text=/Sarah Chen/')).toHaveCount(0)
  })
})
