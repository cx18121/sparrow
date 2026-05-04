import { test, expect, type Page } from '@playwright/test'
import { mockApi, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

async function signInDemo(page: Page) {
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

test.describe('Mobile navigation UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signInDemo(page)
    await mockApi(page, { templates: [SAMPLE_TEMPLATE] })
  })

  test('bottom navigation exposes Home, Templates, and Settings without the desktop sidebar', async ({ page }) => {
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
