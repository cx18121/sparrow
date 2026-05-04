import { test, expect } from '@playwright/test'
import { mockApi, SAMPLE_LEAD, SAMPLE_TEMPLATE, SAMPLE_COMPANY } from './fixtures/api-mocks'

// In demo mode (VITE_SUPABASE_URL unset) the AuthContext seeds a localStorage demo
// user when sign-in runs. We pre-seed it here so tests can skip the auth screen.
async function signInDemo(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const id = 'demo-user-id'
    localStorage.setItem('cf_demo_id', id)
    localStorage.setItem('cf_demo_user', JSON.stringify({
      id, email: 'demo@test.local',
      user_metadata: { full_name: 'Demo User', avatar_url: null },
    }))
    // Mark onboarding complete so we skip the wizard.
    localStorage.setItem(`cf_onboarding_${id}`, JSON.stringify({
      completed: true,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: { senderName: 'Demo User', styleProfile: { examples: ['hi'] } },
    }))
  })
}

test.describe('Sparrow smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await signInDemo(page)
    await mockApi(page)
  })

  test('app loads to home', async ({ page }) => {
    await page.goto('/dashboard')
    // Home page content: greeting OR welcome card (depending on whether
    // campaigns exist). The default mock has no campaigns, so the welcome
    // card with "Create your first campaign" should render.
    await expect(page.locator('text=/Create your first campaign|Good morning|Welcome/i').first()).toBeVisible({ timeout: 10_000 })
  })

  test('all main tabs are reachable from sidebar (regression: bug 4 + 5)', async ({ page }) => {
    // Use a viewport wide enough to render the desktop sidebar (tabs are hidden on mobile)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/dashboard')
    await page.waitForSelector('nav, [role="navigation"]', { timeout: 10_000 })

    // Each tab must be present in the sidebar's DOM — previously Templates and Contacts were filtered out entirely
    const tabs = ['Home', 'Campaigns', 'Discover', 'Contacts', 'Drafts', 'Templates', 'Settings']
    for (const tab of tabs) {
      const count = await page.locator(`nav >> text=${tab}`).count()
      expect(count, `Tab "${tab}" not found in sidebar`).toBeGreaterThan(0)
    }
  })

  test('navigation between tabs does not crash', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForSelector('nav, [role="navigation"]')

    for (const path of ['/campaigns', '/leads', '/contacts', '/drafts', '/templates', '/settings']) {
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      await page.goto(path)
      // Give React time to mount and any errors to surface
      await page.waitForLoadState('networkidle')
      expect(errors, `Errors visiting ${path}: ${errors.join(', ')}`).toHaveLength(0)
    }
  })

  test('campaigns page shows empty state quickly without spinner blocker (regression: bug 6)', async ({ page }) => {
    await page.goto('/campaigns')
    // Should resolve to either "Loading…" briefly or empty state, never get stuck
    await expect(page.locator('text=/No campaigns yet|Create a campaign/i').first()).toBeVisible({ timeout: 5_000 })
  })

  test('templates tab is reachable and renders (regression: bug 4)', async ({ page }) => {
    await mockApi(page, { templates: [SAMPLE_TEMPLATE] })
    await page.goto('/templates')
    await expect(page.getByText(SAMPLE_TEMPLATE.name).first()).toBeVisible({ timeout: 10_000 })
  })

  test('contacts tab is reachable and shows leads (regression: bug 5)', async ({ page }) => {
    await mockApi(page, { leads: [SAMPLE_LEAD] })
    await page.goto('/contacts')
    await expect(page.getByText(SAMPLE_LEAD.contact.name)).toBeVisible({ timeout: 10_000 })
  })

  test('discover page works without an active campaign (regression: bug 4)', async ({ page }) => {
    await mockApi(page, { companies: [SAMPLE_COMPANY] })
    await page.goto('/leads')
    // Should NOT redirect to /campaigns
    await expect(page).toHaveURL(/\/leads/)
    await expect(page.getByText(SAMPLE_COMPANY.name)).toBeVisible({ timeout: 10_000 })
  })

  test('discover does not auto-search Apollo for every company on page load (regression: bug 2)', async ({ page }) => {
    let apolloSearchCount = 0
    await mockApi(page, { companies: Array.from({ length: 5 }, (_, i) => ({ ...SAMPLE_COMPANY, id: `co_${i}`, name: `Company ${i}` })) })
    await page.route('**/api/apollo-search', route => {
      if (route.request().method() === 'POST') apolloSearchCount += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ previews: [], companyId: 'x' }) })
    })

    await page.goto('/leads')
    await page.waitForLoadState('networkidle')

    // Background loop used to fire one POST per company. With the fix, it only fires when
    // the user actually clicks "Find contacts".
    expect(apolloSearchCount, 'apollo-search must not be called on page load').toBe(0)
  })
})
