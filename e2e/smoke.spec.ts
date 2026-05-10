import { test, expect } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestCampaign,
  createTestTemplate,
  cleanupTestData,
  SAMPLE_COMPANY,
} from './fixtures/api-mocks'

let userId: string

test.describe('Sparrow smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('app loads to home', async ({ page }) => {
    await page.goto('/dashboard')
    // Home page content: greeting OR welcome card (depending on whether
    // campaigns exist). The default state has no campaigns, so the welcome
    // card with "Create your first campaign" should render.
    await expect(
      page.locator('text=/Create your first campaign|Good morning|Welcome/i').first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('sidebar exposes the three top-level tabs (Phase 4e IA)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/dashboard')
    await page.waitForSelector('nav, [role="navigation"]', { timeout: 10_000 })

    // After Phase 4e the sidebar settles on Home / Templates / Settings.
    const expectedTabs = ['Home', 'Templates', 'Settings']
    for (const tab of expectedTabs) {
      const count = await page.locator(`nav >> text=${tab}`).count()
      expect(count, `Tab "${tab}" not found in sidebar`).toBeGreaterThan(0)
    }

    // The retired top-level surfaces should no longer appear as sidebar items.
    for (const retired of ['Discover', 'Contacts', 'Drafts', 'Campaigns']) {
      const count = await page.locator(`nav >> text=${retired}`).count()
      expect(count, `Retired tab "${retired}" still in sidebar`).toBe(0)
    }
  })

  test('legacy bookmarks redirect to /dashboard (Phase 4e)', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForSelector('nav, [role="navigation"]')

    for (const path of ['/campaigns', '/leads', '/contacts', '/drafts']) {
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      expect(errors, `Errors visiting ${path}: ${errors.join(', ')}`).toHaveLength(0)
      await expect(page).toHaveURL(/\/dashboard/)
    }
  })

  test('templates tab is reachable and renders', async ({ page }) => {
    const template = await createTestTemplate(page, { name: 'Cold intro' })
    await page.goto('/templates')
    await expect(page.getByText(template.name).first()).toBeVisible({ timeout: 10_000 })
  })

  test('discover does not auto-search Apollo on first paint inside a workspace (regression: bug 2)', async ({
    page,
  }) => {
    let apolloSearchCount = 0
    const template = await createTestTemplate(page, { name: 'Smoke template' })
    const campaign = await createTestCampaign(page, {
      name: 'Smoke campaign',
      status: 'ACTIVE',
      templateId: template.id,
    })

    await mockApi(page, {
      companiesResponse: {
        items: Array.from({ length: 5 }, (_, i) => ({
          ...SAMPLE_COMPANY,
          id: `co_${i}`,
          name: `Company ${i}`,
        })),
        nextCursor: null,
        seenTotal: 0,
        usingFallback: false,
      },
    })

    await page.route('**/api/apollo-search', route => {
      if (route.request().method() === 'POST') apolloSearchCount += 1
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ previews: [], companyId: 'x' }),
      })
    })

    await page.goto(`/campaigns/${campaign.id}/leads`)
    await page.waitForLoadState('networkidle')

    // Background loop used to fire one POST per company. With the fix, it only fires when
    // the user actually clicks "Find contacts".
    expect(apolloSearchCount, 'apollo-search must not be called on page load').toBe(0)
  })
})
