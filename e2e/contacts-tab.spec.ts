import { test, expect } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestCampaign,
  createTestTemplate,
  cleanupTestData,
  SAMPLE_COMPANY,
} from './fixtures/api-mocks'

// Contacts sub-tab — Phase F2
//   - New /campaigns/:id/contacts route exists
//   - Empty state when no leads saved to this campaign
//   - Lists saved leads with status pills
//   - "Generate draft" button calls /api/emails/generate and re-renders
//     with status flipped from "No draft" to "Draft ready"

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
  contact: {
    id: 'contact_contacts_1',
    name: 'Sarah Chen',
    email: 'sarah@acme.test',
    title: 'Head of Engineering',
  },
  emails: [],
}

let userId: string
let campaignId: string

test.describe('Contacts sub-tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    const template = await createTestTemplate(page, { name: 'Cold intro' })
    const campaign = await createTestCampaign(page, {
      name: 'Series A AI infra',
      status: 'ACTIVE',
      templateId: template.id,
    })
    campaignId = campaign.id
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('Contacts tab appears in sub-tab nav between Leads and Drafts', async ({ page }) => {
    await page.route('**/api/campaign-leads**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      }),
    )

    await page.goto(`/campaigns/${campaignId}/overview`)
    await expect(page.getByRole('tab', { name: 'Contacts', exact: true })).toBeVisible({
      timeout: 10_000,
    })

    await page.getByRole('tab', { name: 'Contacts', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/contacts`))
  })

  test('renders empty state when no contacts are saved to this campaign', async ({ page }) => {
    await page.route('**/api/campaign-leads**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      }),
    )

    await page.goto(`/campaigns/${campaignId}/contacts`)
    await expect(page.locator('text=/No saved contacts yet/i')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button', { hasText: /Find leads/i })).toBeVisible()
  })

  test('lists a saved contact with No-draft status and a Generate-draft button', async ({
    page,
  }) => {
    await page.route('**/api/campaign-leads**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [SAVED_LEAD] }),
      }),
    )

    await page.goto(`/campaigns/${campaignId}/contacts`)
    await expect(page.locator('text=/Sarah Chen/').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=/Head of Engineering/i')).toBeVisible()
    await expect(page.locator('text=/Acme Robotics/i')).toBeVisible()
    await expect(page.locator('text=/No draft/i').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Generate draft/i })).toBeVisible()
  })

  test('Generate-draft button calls /api/emails/generate and flips status to Draft ready', async ({
    page,
  }) => {
    // The generate-draft call flips a flag; subsequent campaign-leads fetches
    // include the new draft.
    let draftGenerated = false
    await page.route('**/api/campaign-leads**', route => {
      const lead = draftGenerated
        ? { ...SAVED_LEAD, emails: [{ id: 'em_new', subject: 'Quick', status: 'draft' }] }
        : SAVED_LEAD
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [lead] }),
      })
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

    await page.goto(`/campaigns/${campaignId}/contacts`)
    await expect(page.locator('text=/Sarah Chen/').first()).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /Generate draft/i }).click()

    await expect(page.locator('text=/Draft ready/i')).toBeVisible({ timeout: 10_000 })
    await expect(
      page.locator('a, button', { hasText: /Open in Drafts/i }).first(),
    ).toBeVisible()

    expect(generateCalled).toBe(true)
    // Contract: campaign-scoped Generate must carry the campaign's templateId.
    expect(generatePayload?.userLeadId).toBe(SAVED_LEAD.id)
    expect(generatePayload?.save).toBe(true)
  })

  test('select-all + bulk Generate triggers /api/emails/generate per selected no-draft lead', async ({
    page,
  }) => {
    const SAVED_LEAD_2 = {
      ...SAVED_LEAD,
      id: 'lead_contacts_2',
      contactId: 'contact_contacts_2',
      contact: {
        id: 'contact_contacts_2',
        name: 'Devon Park',
        email: 'devon@acme.test',
        title: 'CTO',
      },
    }

    await page.route('**/api/campaign-leads**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [SAVED_LEAD, SAVED_LEAD_2] }),
      }),
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

    await page.goto(`/campaigns/${campaignId}/contacts`)
    await expect(page.locator('text=/Sarah Chen/').first()).toBeVisible({ timeout: 10_000 })

    await page.getByLabel('Select all').check()
    await expect(page.locator('text=/2 selected/')).toBeVisible()

    await page.getByRole('button', { name: /^Generate \(2\)$/ }).click()

    await expect.poll(() => generateCalls, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  })

  test('bulk Remove deletes selected campaign-lead links via DELETE /api/campaign-leads', async ({
    page,
  }) => {
    const LEAD_A = { ...SAVED_LEAD, campaignLeadId: 'cl_a' }
    const LEAD_B = {
      ...SAVED_LEAD,
      id: 'lead_contacts_2',
      campaignLeadId: 'cl_b',
      contact: { id: 'c2', name: 'Devon Park', title: 'CTO' },
    }

    let removed = false
    await page.route('**/api/campaign-leads**', route => {
      const method = route.request().method()
      if (method === 'DELETE') {
        removed = true
        return route.fulfill({ status: 204, body: '' })
      }
      const items = removed ? [LEAD_B] : [LEAD_A, LEAD_B]
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items }),
      })
    })
    await page.addInitScript(() => {
      window.confirm = () => true
    })

    await page.goto(`/campaigns/${campaignId}/contacts`)
    await expect(page.locator('text=/Sarah Chen/').first()).toBeVisible({ timeout: 10_000 })

    await page.getByLabel('Select Sarah Chen').check()
    await expect(page.locator('text=/1 selected/')).toBeVisible()

    await page.getByRole('button', { name: /^Remove$/ }).click()

    await expect.poll(() => removed, { timeout: 10_000 }).toBe(true)
    await expect(page.locator('text=/Devon Park/')).toBeVisible()
    await expect(page.locator('text=/Sarah Chen/')).toHaveCount(0)
  })

  test('Add contact form inputs have programmatic labels', async ({ page }) => {
    await page.route('**/api/campaign-leads?**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      }),
    )

    await page.goto(`/campaigns/${campaignId}/contacts`)
    await page.getByRole('button', { name: /Add contact/i }).click()

    // Each input is reachable by its visible label text via getByLabel —
    // proves htmlFor+id pairs are wired correctly. Pre-this-work the
    // wrapping <label> matched via implicit association in browsers but
    // diverged from the rest of the codebase's explicit pattern.
    await expect(page.getByLabel(/^Name$/)).toBeVisible()
    await expect(page.getByLabel(/^Email$/)).toBeVisible()
    await expect(page.getByLabel(/^Title$/)).toBeVisible()
    await expect(page.getByLabel(/^Company$/)).toBeVisible()

    await page.getByLabel(/^Name$/).fill('Test Contact')
    await expect(page.getByLabel(/^Name$/)).toHaveValue('Test Contact')
  })
})
