// E2E for the close+reopen cache-hit path of ApolloDialog. The existing
// lead-discovery-ux specs cover the cache-miss + save-into-campaign paths;
// this one specifically asserts that the second open of the SAME company
// does NOT re-hit /api/apollo-search, which is the central reason the cache
// state lives in the parent (LeadDiscoveryTab) rather than the dialog.
import { test, expect, type Route } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestCampaign,
  createTestTemplate,
  cleanupTestData,
  SAMPLE_COMPANY,
} from './fixtures/api-mocks'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

let userId: string
let campaignId: string

test.describe('ApolloDialog cache', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    const template = await createTestTemplate(page, { name: 'Cache test template' })
    const campaign = await createTestCampaign(page, {
      name: 'Cache test campaign',
      status: 'ACTIVE',
      templateId: template.id,
    })
    campaignId = campaign.id
    await mockApi(page, {
      companiesResponse: {
        items: [SAMPLE_COMPANY],
        nextCursor: null,
        seenTotal: 0,
        usingFallback: false,
      },
    })
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('reopening the same company hits the cache and does NOT re-fetch contacts', async ({ page }) => {
    let apolloSearchCallCount = 0
    let revealCallCount = 0
    await page.route('**/api/apollo-search', route => {
      const method = route.request().method()
      if (method === 'POST') {
        apolloSearchCallCount++
        return json(route, {
          companyId: SAMPLE_COMPANY.id,
          usedFallback: false,
          previews: [
            {
              id: 'person_cache_1',
              firstName: 'Cache',
              lastNameObfuscated: 'T***',
              title: 'Founder',
              hasEmail: true,
              companyName: SAMPLE_COMPANY.name,
            },
          ],
        })
      }
      if (method === 'PUT') {
        revealCallCount++
        return json(route, { contact: { email: 'cache@acme.test' } })
      }
      return json(route, {})
    })

    await page.goto(`/campaigns/${campaignId}/leads`)

    // First open: cache miss → must call apolloSearch + revealApolloContact.
    await page.getByRole('button', { name: /Find contacts/i }).first().click()
    await expect(page.locator('text=/Cache T/i').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=/cache@acme\\.test/i').first()).toBeVisible({ timeout: 10_000 })
    expect(apolloSearchCallCount).toBe(1)
    expect(revealCallCount).toBe(1)

    // Close via the dialog close button.
    await page.getByRole('button', { name: /Close dialog/i }).click()
    await expect(page.locator('role=dialog')).toBeHidden()

    // Second open of the SAME company: cache hit → no new network calls.
    // The "Searching for contacts…" placeholder must NOT appear at all —
    // previews should render instantly from the parent's cache.
    await page.getByRole('button', { name: /Find contacts/i }).first().click()
    await expect(page.locator('text=/Cache T/i').first()).toBeVisible()
    await expect(page.locator('text=/cache@acme\\.test/i').first()).toBeVisible()
    // Give any latent fetch ~750ms to fire — if the cache works the counters stay at 1.
    await page.waitForTimeout(750)
    expect(apolloSearchCallCount).toBe(1)
    expect(revealCallCount).toBe(1)
  })
})
