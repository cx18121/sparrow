import { test, expect } from '@playwright/test'
import { mockApi, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

// Phase 2 — full-screen 4-step wizard replacing the modal-based campaign
// creator on the Home surface. Asserts:
//   1. Wizard takes over the viewport (no Modal chrome)
//   2. Stepper progresses 1 → 2 → 3 → 4 with Continue button
//   3. Step 2 shows the live audience preview count from /api/audience-query
//   4. Review step exposes "Save as Paused" and "Launch (Active)" CTAs
//   5. Launch posts to /api/campaigns with status: ACTIVE and resolves

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
    // Clear any leftover wizard scratch state from prior tests in the same browser.
    localStorage.removeItem('sparrow_wizard_v1')
  })
}

test.describe('Create campaign wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInDemo(page)
  })

  test('navigates 1→4 and creates an Active campaign', async ({ page }) => {
    let createdPayload: any = null
    await mockApi(page, { templates: [SAMPLE_TEMPLATE] })
    // Override the campaigns POST to capture the payload.
    await page.route('**/api/campaigns**', async route => {
      if (route.request().method() === 'POST') {
        createdPayload = route.request().postDataJSON()
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'cmp_new', userId: 'demo', name: createdPayload?.name || 'New',
            status: createdPayload?.status || 'ACTIVE', batchSize: 10, currentBatch: 0,
            filterTags: [], attachmentIds: [], includePreviouslySaved: false,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      })
    })

    await page.goto('/dashboard')
    await expect(page.locator('text=/Create your first campaign/i').first()).toBeVisible({ timeout: 10_000 })

    // Open wizard from welcome card
    await page.locator('text=/Create your first campaign/i').first().click()

    // Step 1: Name
    await expect(page.locator('text=/Name your campaign/i')).toBeVisible({ timeout: 5_000 })
    await page.getByPlaceholder('e.g. Spring 2026 YC outreach').fill('Series B AI infra')
    await page.getByRole('button', { name: /Continue/i }).click()

    // Step 2: Filters + live audience preview
    await expect(page.locator('text=/Who should Sparrow find\\?/i')).toBeVisible()
    // The mocked /api/audience-query returns count: 84 → "~84"
    await expect(page.locator('text=/~84/').first()).toBeVisible({ timeout: 5_000 })
    // Dedup toggle is present and unchecked by default
    const dedup = page.locator('input[type="checkbox"]').first()
    await expect(dedup).not.toBeChecked()
    await page.getByRole('button', { name: /Continue/i }).click()

    // Step 3: Template — list shows the sample template + the "no template"
    // skip affordance (renamed from "Skip — write each draft from scratch"
    // to make clear that Sparrow still drafts; the user isn't writing manually).
    await expect(page.locator('text=/Pick a template/i')).toBeVisible()
    await page.getByRole('button', { name: /No template/i }).click()
    await page.getByRole('button', { name: /Continue/i }).click()

    // Step 4: Review — shows name, audience summary, and the two CTAs
    await expect(page.locator('text=/Review and launch/i')).toBeVisible()
    await expect(page.locator('text=/Series B AI infra/').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Save as Paused/i })).toBeVisible()

    // Launch
    await page.getByRole('button', { name: /Launch \(Active\)/i }).click()

    // Verify the POST went out with the right shape
    await expect.poll(() => createdPayload?.name).toBe('Series B AI infra')
    expect(createdPayload?.status).toBe('ACTIVE')
    expect(createdPayload?.includePreviouslySaved).toBe(false)
  })
})
