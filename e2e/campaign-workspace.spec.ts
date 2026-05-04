import { test, expect } from '@playwright/test'
import { mockApi, SAMPLE_COMPANY, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

// Phase 3 — campaign workspace shell.
//   - Clicking a campaign card on Home navigates to /campaigns/:id/overview
//   - The persistent header shows the campaign name + status
//   - All five sub-tabs (overview / leads / drafts / sent / settings) are
//     reachable and don't crash
//   - Optimistic temp-id campaign cards are rendered as non-clickable

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
    sessionStorage.removeItem('cf_active_campaign')
  })
}

const CAMPAIGN_ID = 'cmp_workspace_1'
const SAMPLE_CAMPAIGN = {
  id: CAMPAIGN_ID,
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
  includePreviouslySaved: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

test.describe('Campaign workspace shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInDemo(page)
  })

  test('clicking a campaign card lands on /:id/overview and renders all sub-tabs', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })

    await page.goto('/dashboard')
    await expect(page.locator('text=/Series A AI infra hiring/').first()).toBeVisible({ timeout: 10_000 })

    // Click the campaign card → land on workspace overview
    await page.locator('text=/Series A AI infra hiring/').first().click()
    await expect(page).toHaveURL(/\/campaigns\/cmp_workspace_1\/overview/, { timeout: 5_000 })

    // Persistent header shows the name + ACTIVE badge
    const header = page.locator('header').filter({ hasText: 'Series A AI infra hiring' }).first()
    await expect(header).toBeVisible()
    await expect(header.locator('text=/active/i').first()).toBeVisible()

    // Overview shows the audience pill we configured
    await expect(page.locator('text=/series-a/i').first()).toBeVisible()

    // Each sub-tab is reachable without errors
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))

    for (const tab of ['Leads', 'Drafts', 'Sent', 'Settings', 'Overview']) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/campaigns/cmp_workspace_1/${tab.toLowerCase()}`))
    }
    expect(errors, `Errors visiting sub-tabs: ${errors.join(', ')}`).toHaveLength(0)

    // Back-to-Home link works
    await page.locator('a', { hasText: 'Home' }).first().click()
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('refresh into a workspace URL resolves to the workspace, not Home', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })
    await page.goto('/campaigns/cmp_workspace_1/sent')
    await expect(page).toHaveURL(/\/campaigns\/cmp_workspace_1\/sent/, { timeout: 10_000 })
    // Sent is still a placeholder until 4c — its coming-soon copy is what we expect.
    await expect(page.locator('text=/per-campaign send log/i').first()).toBeVisible()
  })

  test('unknown campaign id renders a not-found card instead of crashing', async ({ page }) => {
    await mockApi(page, { campaigns: [], templates: [] })
    await page.goto('/campaigns/cmp_does_not_exist/overview')
    await expect(page.locator('text=/Campaign not found/i').first()).toBeVisible({ timeout: 10_000 })
  })

  test('Leads sub-tab mounts Discover and shows companies (Phase 4a)', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      companies: [SAMPLE_COMPANY],
    })
    await page.goto('/campaigns/cmp_workspace_1/leads')
    // The Discover surface renders the sample company plus its Find contacts CTA.
    await expect(page.locator(`text=${SAMPLE_COMPANY.name}`).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /Find contacts/i }).first()).toBeVisible()
    // The "Browsing for X" banner confirms the workspace is scoping the discover.
    await expect(page.locator('text=/Browsing for/i').first()).toBeVisible()
  })

  test('optimistic temp-id campaign card is rendered as non-clickable', async ({ page }) => {
    const tempCampaign = { ...SAMPLE_CAMPAIGN, id: 'temp-pending-123', name: 'Optimistic pending' }
    await mockApi(page, {
      campaigns: [tempCampaign],
      templates: [SAMPLE_TEMPLATE],
    })
    await page.goto('/dashboard')
    const card = page.getByRole('button', { name: /Optimistic pending/i }).first()
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toBeDisabled()
    await expect(page.locator('text=/Saving…/').first()).toBeVisible()
  })
})
