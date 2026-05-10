import { test, expect } from '@playwright/test'
import { mockApi, signInDemo, cleanupTestData } from './fixtures/api-mocks'

let userId: string

test.describe('Mobile navigation UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('bottom navigation exposes Home, Templates, and Settings without the desktop sidebar', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await expect(page.locator('aside').first()).toBeHidden()

    const bottomNav = page.locator('nav.fixed')
    await expect(bottomNav.getByRole('button', { name: /Home/i })).toBeVisible({ timeout: 10_000 })
    await expect(bottomNav.getByRole('button', { name: /Templates/i })).toBeVisible()
    await expect(bottomNav.getByRole('button', { name: /Settings/i })).toBeVisible()

    await page.getByRole('button', { name: /^Templates$/i }).click()
    await expect(page).toHaveURL(/\/templates/)
    await expect(page.getByRole('heading', { name: /Reusable templates/i })).toBeVisible()

    await page.getByRole('button', { name: /^Settings$/i }).click()
    await expect(page).toHaveURL(/\/settings/)
    await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible()
  })
})
