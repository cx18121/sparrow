import { test, expect } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestCampaign,
  createTestDraft,
  cleanupTestData,
} from './fixtures/api-mocks'

// Pins the partial-personalization warning surfaced by DraftsTab. When
// the picker fills only one half of a role's (company-side, candidate-side)
// pair, the server's dropEmptyTagParagraphs silently removes the paragraph
// anchored on the empty tag. Pre-this-work, the user saw a shorter draft
// with no UI signal for why. Now we render an amber banner naming the
// dropped tag(s) and recipient company.
//
// Detection per-role is unit-tested in src/__tests__/detectDroppedTags.test.ts;
// this e2e proves the banner renders in the actual DraftsTab flow.

let userId: string
let campaignId: string

test.describe('Partial-personalization warning banner', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    const campaign = await createTestCampaign(page, { name: 'Warning e2e', status: 'ACTIVE' })
    campaignId = campaign.id
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('shows {{fit_angle}} dropped warning when only the eng company-side line is filled', async ({ page }) => {
    await createTestDraft(page, {
      userId,
      role: 'eng',
      partial: 'candidate', // featureLine populated, fitAngle null
      companyName: 'PartialEng',
      campaignId,
    })

    await page.goto(`/campaigns/${campaignId}/drafts`)
    await expect(page.getByText('PartialEng').first()).toBeVisible({ timeout: 10_000 })
    await page.getByText('PartialEng').first().click()

    // The banner is rendered as role=status so it's stable to find without
    // coupling to layout copy. Inside, it names the dropped tag + company.
    const warning = page.getByRole('status').filter({ hasText: /{{fit_angle}}/ })
    await expect(warning).toBeVisible({ timeout: 10_000 })
    await expect(warning).toContainText('PartialEng')
    await expect(warning).toContainText(/that paragraph was dropped/i)
  })

  test('shows {{proof_of_motion}} dropped warning for a partial GTM draft', async ({ page }) => {
    await createTestDraft(page, {
      userId,
      role: 'gtm',
      partial: 'candidate',
      companyName: 'PartialGtm',
      campaignId,
    })

    await page.goto(`/campaigns/${campaignId}/drafts`)
    await expect(page.getByText('PartialGtm').first()).toBeVisible({ timeout: 10_000 })
    await page.getByText('PartialGtm').first().click()

    const warning = page.getByRole('status').filter({ hasText: /{{proof_of_motion}}/ })
    await expect(warning).toBeVisible({ timeout: 10_000 })
    await expect(warning).toContainText('PartialGtm')
  })

  test('no warning when both halves of the role pair are populated', async ({ page }) => {
    await createTestDraft(page, {
      userId,
      role: 'gtm',
      partial: 'both',
      companyName: 'FullGtm',
      campaignId,
    })

    await page.goto(`/campaigns/${campaignId}/drafts`)
    await expect(page.getByText('FullGtm').first()).toBeVisible({ timeout: 10_000 })
    await page.getByText('FullGtm').first().click()

    // detectDroppedTags should return null — no banner should appear.
    // Wait for the body to render first so we know the preview is loaded.
    await expect(page.locator('text=/Caught the news on/i').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('status').filter({ hasText: /paragraph was dropped/ })).toHaveCount(0)
  })
})
