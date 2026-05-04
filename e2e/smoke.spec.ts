import { test, expect } from '@playwright/test'
import { mockApi, SAMPLE_TEMPLATE, SAMPLE_COMPANY } from './fixtures/api-mocks'

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

  test('sidebar exposes the three top-level tabs (Phase 4e IA)', async ({ page }) => {
    // Use a viewport wide enough to render the desktop sidebar (tabs are hidden on mobile)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/dashboard')
    await page.waitForSelector('nav, [role="navigation"]', { timeout: 10_000 })

    // After Phase 4e the sidebar settles on Home / Templates / Settings —
    // per-campaign work moved into the workspace at /campaigns/:id/*.
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

    // Each retired path should land softly on Home — no crash, no stale route.
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
    await mockApi(page, { templates: [SAMPLE_TEMPLATE] })
    await page.goto('/templates')
    await expect(page.getByText(SAMPLE_TEMPLATE.name).first()).toBeVisible({ timeout: 10_000 })
  })

  test('discover does not auto-search Apollo on first paint inside a workspace (regression: bug 2)', async ({ page }) => {
    let apolloSearchCount = 0
    const campaign = {
      id: 'cmp_smoke_1',
      userId: 'demo',
      name: 'Smoke campaign',
      subject: 'hi',
      status: 'ACTIVE' as const,
      templateId: SAMPLE_TEMPLATE.id,
      filterTags: [],
      filterRegion: null,
      filterStage: null,
      filterBatch: null,
      filterIsHiring: null,
      filterHeadcountMin: null,
      filterHeadcountMax: null,
      batchSize: 10,
      currentBatch: 0,
      tone: null,
      attachmentIds: [],
      scheduledAt: null,
      template: { id: SAMPLE_TEMPLATE.id, name: SAMPLE_TEMPLATE.name },
      includePreviouslySaved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await mockApi(page, {
      campaigns: [campaign],
      templates: [SAMPLE_TEMPLATE],
      companies: Array.from({ length: 5 }, (_, i) => ({ ...SAMPLE_COMPANY, id: `co_${i}`, name: `Company ${i}` })),
    })
    await page.route('**/api/apollo-search', route => {
      if (route.request().method() === 'POST') apolloSearchCount += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ previews: [], companyId: 'x' }) })
    })

    await page.goto(`/campaigns/${campaign.id}/leads`)
    await page.waitForLoadState('networkidle')

    // Background loop used to fire one POST per company. With the fix, it only fires when
    // the user actually clicks "Find contacts".
    expect(apolloSearchCount, 'apollo-search must not be called on page load').toBe(0)
  })
})
