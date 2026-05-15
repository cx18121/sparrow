import { test, expect, type Route } from '@playwright/test'
import { mockApi, signInDemo, createTestTemplate, cleanupTestData } from './fixtures/api-mocks'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

// Regression suite for Bug 07: Gmail connect surface.

let userId: string

async function mockProfileGmailDisconnected(page: import('@playwright/test').Page) {
  await page.route('**/api/profile**', route =>
    json(route, {
      profile: {
        onboardingCompleted: true,
        workspaceConfig: { senderName: 'E2E Test User', templateId: null },
        hasClaudeKey: true,
        hasGoogleRefreshToken: false,
      },
    }),
  )
}

test.describe('Gmail connect button', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    await mockApi(page)
    await mockProfileGmailDisconnected(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('shows Connect button (not Reconnect) when Gmail is not yet connected', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: /Account/ }).click()
    const reconnect = page.getByRole('button', { name: /^reconnect$/i })
    await expect(reconnect, 'Reconnect label is wrong when user has never connected').toHaveCount(0)
    const connect = page.getByRole('button', { name: /^connect$/i })
    await expect(connect).toBeVisible()
  })

  test('clicking Connect surfaces a banner when the connect API call fails', async ({ page }) => {
    await page.route('**/api/google/connect', route =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Could not connect Gmail — server error in test mode' }),
      }),
    )
    await page.goto('/settings')
    await page.getByRole('tab', { name: /Account/ }).click()
    const button = page.getByRole('button', { name: /^connect$/i })
    await expect(button).toBeVisible()
    await button.click()
    const banner = page.locator('text=/Could not connect Gmail/i').first()
    await expect(banner).toBeVisible({ timeout: 5000 })
  })

  test('surfaces error banner when callback redirects back with ?google_error', async ({ page }) => {
    await page.goto('/settings?google_error=callback_failed')
    const banner = page.locator('text=/Could not connect Gmail|Gmail connection failed/i').first()
    await expect(banner).toBeVisible({ timeout: 5000 })
  })

  test('surfaces success banner when callback redirects back with ?google_connected=1', async ({
    page,
  }) => {
    let profileCalls = 0
    await page.route('**/api/profile**', route => {
      profileCalls += 1
      return json(route, {
        profile: {
          onboardingCompleted: true,
          workspaceConfig: { senderName: 'E2E Test User', templateId: null },
          hasClaudeKey: true,
          hasGoogleRefreshToken: profileCalls > 1,
        },
      })
    })
    await page.goto('/settings?google_connected=1')
    const banner = page.locator('text=/Gmail connected/i').first()
    await expect(banner).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('tab', { name: /Account/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // The behavior under test is that the success banner appears and the
    // Account tab is selected after redirect — both asserted above. We don't
    // pin specific banner copy so prose tweaks ("Ready to send drafts" →
    // "Gmail connected for sending") don't break the suite.
  })
})

test.describe('Settings tab structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('renders the three Settings tabs and switching tabs swaps the panel content', async ({
    page,
  }) => {
    await page.goto('/settings')

    for (const label of ['Profile', 'Sending', 'Account']) {
      await expect(page.getByRole('tab', { name: new RegExp(label) })).toBeVisible({
        timeout: 5000,
      })
    }
    await expect(page.getByRole('tab', { name: /Style/ })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: /Integrations/ })).toHaveCount(0)

    // Profile tab has the sender-name input, which Sending and Account don't.
    await expect(page.getByLabel(/Sender name/i)).toBeVisible()

    await page.getByRole('tab', { name: /Sending/ }).click()
    // Sending tab has the lead-batch-size input — a structural anchor that
    // survives copy edits to surrounding labels.
    await expect(page.getByLabel(/Lead batch size/i)).toBeVisible()
    await expect(page.getByLabel(/Sender name/i)).toHaveCount(0)

    await page.getByRole('tab', { name: /Account/ }).click()
    // Account tab is structurally identified by sign-out + delete buttons,
    // not by the section copy.
    await expect(page.getByRole('button', { name: /Sign out/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Delete account/i })).toBeVisible()
  })

  test('delete account confirms, calls the account endpoint, and signs out', async ({ page }) => {
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
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible()
  })

  test('delete account waits for the server deletion before signing out', async ({ page }) => {
    let finishDelete: (() => void) | null = null
    await page.route('**/api/account', async route => {
      if (route.request().method() === 'DELETE') {
        await new Promise<void>(resolve => {
          finishDelete = resolve
        })
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        })
      }
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

    await expect.poll(() => Boolean(finishDelete)).toBe(true)
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toHaveCount(0)
    finishDelete?.()
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible()
  })
})
