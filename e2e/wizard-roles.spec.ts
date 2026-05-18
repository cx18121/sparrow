import { test, expect } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  cleanupTestData,
} from './fixtures/api-mocks'

// Role-aware wizard targeting. Verifies the picker:
//   1. Renders the "What role are you looking for?" section on Step 1
//      (Filters), above the existing "Who should Sparrow find?" block.
//   2. Defaults to the user's workspace targetRole (engineering for new
//      users without an override).
//   3. Click-to-expand exposes the 4 family tiles.
//   4. Picking a non-default family flips the summary and surfaces the
//      "(overrides your default)" hint.
//   5. The campaign POST body carries the explicit filterTargetRole value
//      — the refactor's primary user-visible behavior.

let userId: string

test.describe('wizard target-role picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    await page.addInitScript(() => {
      localStorage.removeItem('sparrow_wizard_v1')
    })
    await mockApi(page, { audienceQueryResponse: { count: 50, sample: [] } })
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('renders picker on Step 1 with the user default selected and click-to-expand', async ({ page }) => {
    await page.goto('/dashboard?new=1')

    // Step 1: Name
    await page.getByPlaceholder('e.g. Spring 2026 YC outreach').fill('Role test')
    await page.getByRole('button', { name: /Continue/i }).click()

    // Step 2: Filters — the role picker lives above the audience block.
    await expect(page.locator('text=/What role are you looking for\\?/i')).toBeVisible()
    // Collapsed summary shows the resolved role (engineering = default
    // until the user changes their workspace default).
    await expect(page.locator('text=/^Engineering$/').first()).toBeVisible()

    // Expand to see the 4 tiles.
    await page.getByRole('button', { name: /^Change$/ }).click()
    for (const label of ['Engineering', 'Product & Design', 'GTM', 'Operations']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    }

    // Engineering pressed by default.
    await expect(page.getByRole('button', { name: 'Engineering', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })

  test('picking a non-default family flips the summary and tags an override hint', async ({ page }) => {
    await page.goto('/dashboard?new=1')
    await page.getByPlaceholder('e.g. Spring 2026 YC outreach').fill('GTM applicant')
    await page.getByRole('button', { name: /Continue/i }).click()

    await page.getByRole('button', { name: /^Change$/ }).click()
    await page.getByRole('button', { name: 'GTM', exact: true }).click()

    // Picker collapses; summary now shows GTM with the override hint.
    await expect(page.locator('text=/^GTM$/').first()).toBeVisible()
    await expect(page.locator('text=/overrides your default/i')).toBeVisible()
  })

  test('campaign POST body carries the picked filterTargetRole', async ({ page }) => {
    // Intercept the create-campaign request so we can assert the wire format
    // without depending on the seeded DB state.
    let postedBody: any = null
    await page.route('**/api/campaigns', async (route, req) => {
      if (req.method() === 'POST') {
        postedBody = req.postDataJSON()
        return route.fulfill({
          status: 201,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'c-test', name: postedBody?.name ?? 'x', status: 'ACTIVE' }),
        })
      }
      return route.fallback()
    })

    await page.goto('/dashboard?new=1')
    await page.getByPlaceholder('e.g. Spring 2026 YC outreach').fill('Wire-format check')
    await page.getByRole('button', { name: /Continue/i }).click()

    // Pick GTM as the per-campaign role.
    await page.getByRole('button', { name: /^Change$/ }).click()
    await page.getByRole('button', { name: 'GTM', exact: true }).click()

    // Walk through the rest of the wizard with defaults.
    await page.getByRole('button', { name: /Continue/i }).click() // → Template
    await page.getByRole('button', { name: /No template/i }).click()
    await page.getByRole('button', { name: /Continue/i }).click() // → Review

    await page.getByRole('button', { name: /Launch \(Active\)/i }).click()

    // The wire format must carry the chosen role — the whole point of the
    // refactor. Without this, Apollo discovery falls back to the engineering
    // default at /api/apollo-search even though the user picked GTM.
    await expect.poll(() => postedBody?.filterTargetRole, { timeout: 5_000 }).toBe('gtm')
  })
})
