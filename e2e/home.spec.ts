import { test, expect } from '@playwright/test'
import { mockApi, SAMPLE_LEAD, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

// Regression suite for the new Home page (Phase 1 of the campaigns-as-workspaces
// redesign). Asserts the locked PRD shape:
//   - 0 campaigns → single welcome card, no KPI strip
//   - 1+ campaigns → greeting + 3 KPI cards (Lead Pool / Drafts / Sent This Week)
//                  + campaign grid + "+ New campaign" empty cell
// Replies KPI is intentionally NOT shown — reply tracking is a future phase.

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
  })
}

const SAMPLE_CAMPAIGN = {
  id: 'cmp_1',
  userId: 'demo',
  name: 'Series A AI infra hiring',
  subject: 'Quick question',
  status: 'ACTIVE' as const,
  templateId: SAMPLE_TEMPLATE.id,
  filterTags: ['stage:series-a'],
  filterRegion: null,
  filterStage: null,
  filterBatch: null,
  filterIsHiring: null,
  filterHeadcountMin: null,
  filterHeadcountMax: null,
  batchSize: 10,
  currentBatch: 1,
  tone: null,
  attachmentIds: [],
  scheduledAt: null,
  template: { id: SAMPLE_TEMPLATE.id, name: SAMPLE_TEMPLATE.name },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

test.describe('Home page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInDemo(page)
  })

  test('empty state shows a single welcome card and no KPI strip', async ({ page }) => {
    await mockApi(page) // no campaigns, no leads, no drafts
    await page.goto('/dashboard')
    const welcome = page.locator('text=/Create your first campaign|Welcome/i').first()
    await expect(welcome).toBeVisible({ timeout: 10_000 })
    // KPI labels must not be present in empty state
    await expect(page.locator('text=/^lead pool$/i').first()).toHaveCount(0)
  })

  test('populated home shows greeting, 3 KPI cards, and campaign grid', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      leads: [SAMPLE_LEAD],
      templates: [SAMPLE_TEMPLATE],
    })
    // Override the default profile so workspaceConfig.senderName matches the
    // signed-in identity. The greeting reads from workspaceConfig.senderName,
    // not from supabase user metadata, so without this override the greeting
    // would render "Good morning, Demo." and the /Alex/ assertion would only
    // pass via sidebar/topnav user-name bleed (not what we want to test).
    await page.route('**/api/profile', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: {
            onboardingCompleted: true,
            workspaceConfig: { senderName: 'Alex Tester', templateId: null },
            hasClaudeKey: true,
            hasGoogleRefreshToken: true,
          },
        }),
      })
    )
    await page.goto('/dashboard')

    // Greeting (Outfit display, "Good morning, Alex.")
    await expect(page.locator('text=/Good morning, Alex/').first()).toBeVisible({ timeout: 10_000 })

    // 3 KPI labels — must all exist
    await expect(page.locator('text=/^lead pool$/i').first()).toBeVisible()
    await expect(page.locator('text=/^drafts$/i').first()).toBeVisible()
    await expect(page.locator('text=/sent this week/i').first()).toBeVisible()

    // Replies must NOT be present — that's a future phase
    await expect(page.locator('text=/^replies$/i').first()).toHaveCount(0)

    // Campaign card with the campaign name
    await expect(page.locator('text=/Series A AI infra hiring/').first()).toBeVisible()

    // "+ New campaign" empty cell
    await expect(page.locator('text=/^new campaign$/i').first()).toBeVisible()
  })
})
