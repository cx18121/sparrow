import { test, expect } from '@playwright/test'
import { mockApi, signInDemo, cleanupTestData } from './fixtures/api-mocks'

// Regression suite for Bug 10G: parallel resource fetches swallow errors and
// silently fall back to cached data. There must be a visible banner when any
// fetch fails so the user knows they are looking at cached state.

let userId: string

test.describe('Resource fetch failure surfacing', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('shows a banner when fetchCampaigns fails', async ({ page }) => {
    // Override only campaigns to fail — the real API would succeed, but we
    // simulate a server error to test the UI's error surfacing.
    await page.route('**/api/campaigns**', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'oops' }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      })
    })

    await page.goto('/dashboard')
    const banner = page.locator('text=/Some data could not refresh|cached/i').first()
    await expect(banner).toBeVisible({ timeout: 10_000 })
  })

  test('does not show a banner when all fetches succeed', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    const banner = page.locator('text=/Some data could not refresh|cached/i').first()
    await expect(banner).toHaveCount(0)
  })
})
