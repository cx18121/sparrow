import { test, expect } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestCampaign,
  createTestTemplate,
  cleanupTestData,
} from './fixtures/api-mocks'

// Regression suite for the Home page.
//   - 0 campaigns → single welcome card, no KPI strip
//   - 1+ campaigns → greeting + 3 KPI cards + campaign grid + "+ New campaign" empty cell

let userId: string

test.describe('Home page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('empty state shows a single welcome card and no KPI strip', async ({ page }) => {
    await page.goto('/dashboard')
    const welcome = page.locator('text=/Create your first campaign|Welcome/i').first()
    await expect(welcome).toBeVisible({ timeout: 10_000 })
    // KPI labels must not be present in empty state
    await expect(page.locator('text=/^lead pool$/i').first()).toHaveCount(0)
  })

  test('populated home shows greeting, KPI cards, and campaign grid', async ({ page }) => {
    const template = await createTestTemplate(page, { name: 'Cold intro' })
    const campaign = await createTestCampaign(page, {
      name: 'Series A AI infra hiring',
      status: 'ACTIVE',
      templateId: template.id,
    })

    await page.goto('/dashboard')

    // Greeting with user's name from the seeded session
    await expect(page.locator('text=/E2E/').first()).toBeVisible({ timeout: 10_000 })

    // Two KPI cells live on the divided KPI strip: Lead Pool and Drafts.
    // Send-related counts moved to the SendActivity sentence below so the
    // strip stays compact — the "sent this week" string still exists, but
    // outside the KPI grid.
    await expect(page.locator('text=/^lead pool$/i').first()).toBeVisible()
    await expect(page.locator('text=/^drafts$/i').first()).toBeVisible()

    // Campaign card
    await expect(page.locator(`text=/Series A AI infra hiring/`).first()).toBeVisible()
  })
})
