import { test, expect } from '@playwright/test'

test.describe('Auth UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.addInitScript(() => {
      localStorage.removeItem('cf_demo_user')
      localStorage.removeItem('cf_demo_id')
    })
  })

  test('switches between sign-in and sign-up modes without losing form affordances', async ({ page }) => {
    await page.goto('/dashboard')

    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=/Demo mode: enter any email and password/i')).toBeVisible()
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
    await expect(page.getByPlaceholder('••••••••')).toBeVisible()

    await page.getByRole('button', { name: /^Sign up$/i }).click()
    await expect(page.getByRole('heading', { name: /Create account/i })).toBeVisible()
    await expect(page.getByPlaceholder('Jane Smith')).toBeVisible()

    await page.getByRole('button', { name: /^Sign in$/i }).click()
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible()
    await expect(page.getByPlaceholder('Jane Smith')).toHaveCount(0)
  })

  test('surfaces a clear demo-mode Google OAuth error', async ({ page }) => {
    await page.goto('/dashboard')

    await page.getByRole('button', { name: /Continue with Google/i }).click()

    await expect(page.locator('text=/Google sign-in could not open/i')).toBeVisible({ timeout: 5_000 })
  })
})
