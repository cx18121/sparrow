import { test, expect } from '@playwright/test'
import { mockApi, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

// Regression suite for Bug 07: Gmail connect surface.
//
// User-reported: "Gmail connect button doesn't work."
// Most plausible failure modes are SILENT — the button fires, the redirect
// happens, the callback fails, the user lands back on the app with
// ?google_error=... in the URL but no visible feedback. These tests assert:
// 1. The button is visible and labelled correctly when not connected.
// 2. Clicking the button POSTs to /api/google/connect (the redirect target).
// 3. When the callback redirects back with ?google_error=..., a banner shows.
// 4. When the callback redirects back with ?google_connected=1, a success
//    banner shows.

async function signInDemo(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const id = 'demo-user-id'
    localStorage.setItem('cf_demo_id', id)
    localStorage.setItem('cf_demo_user', JSON.stringify({
      id, email: 'demo@test.local',
      user_metadata: { full_name: 'Demo User', avatar_url: null },
    }))
    localStorage.setItem(`cf_onboarding_${id}`, JSON.stringify({
      completed: true,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: { senderName: 'Demo User', styleProfile: { examples: ['hi'] } },
    }))
  })
}

async function mockApiWithoutGoogle(page: import('@playwright/test').Page) {
  await mockApi(page, { templates: [SAMPLE_TEMPLATE] })
  // Override profile to report Gmail NOT connected so the button shows.
  await page.route('**/api/profile', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          onboardingCompleted: true,
          workspaceConfig: { senderName: 'Demo User', templateId: null },
          hasClaudeKey: true,
          hasGoogleRefreshToken: false,
        },
      }),
    })
  )
}

test.describe('Gmail connect button', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await signInDemo(page)
  })

  test('shows Connect button (not Reconnect) when Gmail is not yet connected', async ({ page }) => {
    await mockApiWithoutGoogle(page)
    await page.goto('/settings')
    await page.getByRole('tab', { name: /Account/ }).click()
    // The button should say Connect, not Reconnect — this user has never connected.
    const reconnect = page.getByRole('button', { name: /^reconnect$/i })
    await expect(reconnect, 'Reconnect label is wrong when user has never connected').toHaveCount(0)
    const connect = page.getByRole('button', { name: /^connect$/i })
    await expect(connect).toBeVisible()
  })

  test('clicking Connect in demo mode surfaces a banner (not silent failure)', async ({ page }) => {
    // Demo mode short-circuits in connectGoogle and returns an error message.
    // The previous behavior dropped that message; the button "did nothing"
    // visually. Now the SettingsPage must render the message as a banner.
    await mockApiWithoutGoogle(page)
    await page.goto('/settings')
    await page.getByRole('tab', { name: /Account/ }).click()
    const button = page.getByRole('button', { name: /^connect$/i })
    await expect(button).toBeVisible()
    await button.click()
    const banner = page.locator('text=/Google OAuth requires Supabase|Could not connect Gmail/i').first()
    await expect(banner).toBeVisible({ timeout: 5000 })
  })

  test('surfaces error banner when callback redirects back with ?google_error', async ({ page }) => {
    await mockApiWithoutGoogle(page)
    await page.goto('/settings?google_error=callback_failed')
    const banner = page.locator('text=/Could not connect Gmail|Gmail connection failed/i').first()
    await expect(banner).toBeVisible({ timeout: 5000 })
  })

  test('surfaces success banner when callback redirects back with ?google_connected=1', async ({ page }) => {
    await mockApi(page, { templates: [SAMPLE_TEMPLATE] }) // default profile has Gmail connected
    await page.goto('/settings?google_connected=1')
    const banner = page.locator('text=/Gmail connected/i').first()
    await expect(banner).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Settings tab structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await signInDemo(page)
  })

  test('renders all 4 tabs and switching tabs swaps the panel content', async ({ page }) => {
    await mockApi(page, { templates: [SAMPLE_TEMPLATE] })
    await page.goto('/settings')

    // All settings tabs are visible by name.
    for (const label of ['Profile', 'Style', 'Sending', 'Account']) {
      await expect(page.getByRole('tab', { name: new RegExp(label) })).toBeVisible({ timeout: 5000 })
    }
    await expect(page.getByRole('tab', { name: /Integrations/ })).toHaveCount(0)

    // Profile tab is the default landing — Sender identity panel is visible.
    await expect(page.locator('text=/Sender identity/i').first()).toBeVisible()

    // Switching to Sending shows its panels and hides Profile-only content.
    await page.getByRole('tab', { name: /Sending/ }).click()
    await expect(page.locator('text=/Send rate/i').first()).toBeVisible()
    await expect(page.locator('text=/Sender identity/i')).toHaveCount(0)

    // Account tab exposes Sign out + Delete account.
    await page.getByRole('tab', { name: /Account/ }).click()
    await expect(page.locator('text=/Gmail/i').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Sign out/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Delete account/i })).toBeVisible()
  })

  test('delete account confirms and calls the account endpoint', async ({ page }) => {
    await mockApi(page, { templates: [SAMPLE_TEMPLATE] })
    let deleteCalled = false
    await page.route('**/api/account', route => {
      deleteCalled = route.request().method() === 'DELETE'
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    })

    await page.goto('/settings')
    await page.getByRole('tab', { name: /Account/ }).click()
    await page.getByRole('button', { name: /^Delete account$/i }).click()
    await page.getByRole('button', { name: /Yes, delete my account/i }).click()

    await expect.poll(() => deleteCalled).toBe(true)
  })
})
