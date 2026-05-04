import { test, expect } from '@playwright/test'
import { mockApi, SAMPLE_COMPANY, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

// Contacts sub-tab — Phase F2
//   - New /campaigns/:id/contacts route exists
//   - Empty state when no leads saved to this campaign
//   - Lists saved leads with status pills
//   - "Generate draft" button calls /api/emails/generate and re-renders
//     with status flipped from "No draft" to "Draft ready"

async function signInDemo(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const id = 'demo-user-id'
    localStorage.setItem('cf_demo_id', id)
    localStorage.setItem('cf_demo_user', JSON.stringify({
      id, email: 'demo@test.local',
      user_metadata: { full_name: 'Alex Tester', avatar_url: null },
    }))
    localStorage.setItem(`cf_onboarding_${id}`, JSON.stringify({
      completed: true,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: { senderName: 'Alex Tester', styleProfile: { examples: ['hi'] } },
    }))
  })
}

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
    await page.route('**/api/emails/generate', route => {
      generateCalled = true
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
  })
})
