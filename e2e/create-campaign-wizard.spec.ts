import { test, expect } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestTemplate,
  cleanupTestData,
} from './fixtures/api-mocks'

// Phase 2 — full-screen 4-step wizard replacing the modal-based campaign
// creator on the Home surface.

let userId: string

test.describe('Create campaign wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    // Clear any leftover wizard scratch state from prior tests in the same browser.
    await page.addInitScript(() => {
      localStorage.removeItem('sparrow_wizard_v1')
    })
    await mockApi(page, { audienceQueryResponse: { count: 84, sample: [] } })
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('navigates 1→4 and creates an Active campaign', async ({ page }) => {
    const template = await createTestTemplate(page, { name: 'Cold intro' })

    await page.goto('/dashboard')
    await expect(
      page.locator('text=/Create your first campaign/i').first(),
    ).toBeVisible({ timeout: 10_000 })

    await page.locator('text=/Create your first campaign/i').first().click()

    // Step 1: Name
    await expect(page.locator('text=/Name your campaign/i')).toBeVisible({ timeout: 5_000 })
    await page.getByPlaceholder('e.g. Spring 2026 YC outreach').fill('Series B AI infra')
    await page.getByRole('button', { name: /Continue/i }).click()

    // Step 2: Filters + live audience preview
    await expect(page.locator('text=/Who should Sparrow find\\?/i')).toBeVisible()
    // audienceQueryResponse returns count: 84 → "~84"
    await expect(page.locator('text=/~84/').first()).toBeVisible({ timeout: 5_000 })
    const dedup = page.locator('input[type="checkbox"]').first()
    await expect(dedup).not.toBeChecked()
    await page.getByRole('button', { name: /Continue/i }).click()

    // Step 3: Template
    await expect(page.locator('text=/Pick a template/i')).toBeVisible()
    await page.getByRole('button', { name: /No template/i }).click()
    await page.getByRole('button', { name: /Continue/i }).click()

    // Step 4: Review
    await expect(page.locator('text=/Review and launch/i')).toBeVisible()
    await expect(page.locator('text=/Series B AI infra/').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Save as Paused/i })).toBeVisible()

    // Launch — this POSTs to the real API
    await page.getByRole('button', { name: /Launch \(Active\)/i }).click()

    // Verify we land on the dashboard or campaign workspace (POST succeeded)
    await expect(page).toHaveURL(/\/dashboard|\/campaigns\//, { timeout: 10_000 })
  })
})
