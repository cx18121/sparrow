import { test, expect } from '@playwright/test'
import { mockApi, signInDemo } from './fixtures/api-mocks'

// Regression suite for Bug 10G: parallel resource fetches (templates,
// campaigns, leads, customContacts) used to swallow errors and silently
// fall back to cached data. The user saw stale data with no indication
// the refresh failed. There must now be a visible banner when any of the
// four fails so the user knows they are looking at cached state.

test.describe('Resource fetch failure surfacing', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await signInDemo(page)
  })

  test('shows a banner when fetchCampaigns fails', async ({ page }) => {
    await mockApi(page) // baseline (all routes happy)
    // Override only campaigns to fail
    await page.route('**/api/campaigns**', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'oops' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
    })

    await page.goto('/dashboard')
    const banner = page.locator('text=/Some data could not refresh|cached/i').first()
    await expect(banner).toBeVisible({ timeout: 10_000 })
  })

  test('does not show a banner when all fetches succeed', async ({ page }) => {
    await mockApi(page)
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    const banner = page.locator('text=/Some data could not refresh|cached/i').first()
    await expect(banner).toHaveCount(0)
  })
})
