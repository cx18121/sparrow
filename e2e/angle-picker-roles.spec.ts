import { test, expect } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestCampaign,
  createTestDraft,
  cleanupTestData,
} from './fixtures/api-mocks'

// Pins the role-aware AnglePicker contract per ADR-0005 slices 2 + 3.
// Eng's swap-angle path was already covered by the existing suite; this
// file exercises the GTM and ops branches that were unreachable before
// the picker generalization.
//
// For each role:
//   1. Seed a verbatim draft with the role's company-side line populated
//      and its envelope dossier on the company so the picker has options.
//   2. Open the draft in the workspace drafts view.
//   3. Mock /api/emails/angle so the picker doesn't hit Claude (the test
//      key is fake), assert the POST body uses the correct role-shaped
//      field name, and return a controlled re-pick.
//   4. Assert the UI updates the body with the new substitution.

let userId: string
let campaignId: string

test.describe('AnglePicker is role-aware', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    const campaign = await createTestCampaign(page, { name: 'Angle picker e2e', status: 'ACTIVE' })
    campaignId = campaign.id
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('GTM verbatim draft posts triggerLine (not featureLine) and substitutes the new trigger', async ({ page }) => {
    await createTestDraft(page, {
      userId,
      role: 'gtm',
      partial: 'both',
      companyName: 'GtmCo',
      campaignId,
    })

    // Capture the angle-swap call. The picker should POST `triggerLine`
    // for a GTM draft — not `featureLine`. Pre-this-work the picker was
    // hardcoded to featureLine so a GTM draft either silently swapped
    // the wrong field or 400'd.
    let angleBody: any = null
    await page.route('**/api/emails/angle', route => {
      angleBody = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'unused',
          subject: 'Quick note on GtmCo',
          body: '<p>Caught the news on hired VP Sales from Stripe.</p><p>For context, my mid-market AE work is the closest analog.</p>',
          triggerLine: 'hired VP Sales from Stripe',
          proofOfMotion: 'my mid-market AE work',
        }),
      })
    })

    await page.goto(`/campaigns/${campaignId}/drafts`)
    // Open the seeded draft so the AnglePicker renders.
    await expect(page.getByText('GtmCo').first()).toBeVisible({ timeout: 10_000 })
    await page.getByText('GtmCo').first().click()

    // Picker trigger reads the current company-side line for this role.
    const pickerTrigger = page.getByRole('button', { name: /raised Series B in March/i })
    await expect(pickerTrigger).toBeVisible({ timeout: 10_000 })
    await pickerTrigger.click()

    // Menu shows both dossier triggers + recent moves (the GTM picker
    // accepts both as anchor options per server/routes/emails/angle.ts).
    await page.getByRole('button', { name: /hired VP Sales from Stripe/i }).click()

    // Wait for the swap roundtrip + body update.
    await expect.poll(() => angleBody?.triggerLine).toBe('hired VP Sales from Stripe')
    expect(angleBody?.featureLine).toBeUndefined()
    expect(angleBody?.inflectionLine).toBeUndefined()
    await expect(page.locator('text=/hired VP Sales from Stripe/i').first()).toBeVisible()
  })

  test('Ops verbatim draft posts inflectionLine and substitutes the new inflection', async ({ page }) => {
    await createTestDraft(page, {
      userId,
      role: 'ops',
      partial: 'both',
      companyName: 'OpsCo',
      campaignId,
    })

    let angleBody: any = null
    await page.route('**/api/emails/angle', route => {
      angleBody = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'unused',
          subject: 'Quick thought on OpsCo',
          body: '<p>Noticed new EMEA office opening.</p><p>For context, my Chief of Staff role is the closest analog.</p>',
          inflectionLine: 'new EMEA office opening',
          systemBuilt: 'my Chief of Staff role',
        }),
      })
    })

    await page.goto(`/campaigns/${campaignId}/drafts`)
    await expect(page.getByText('OpsCo').first()).toBeVisible({ timeout: 10_000 })
    await page.getByText('OpsCo').first().click()

    const pickerTrigger = page.getByRole('button', { name: /Series D \+ AI agent launches/i })
    await expect(pickerTrigger).toBeVisible({ timeout: 10_000 })
    await pickerTrigger.click()

    await page.getByRole('button', { name: /new EMEA office opening/i }).click()

    await expect.poll(() => angleBody?.inflectionLine).toBe('new EMEA office opening')
    expect(angleBody?.featureLine).toBeUndefined()
    expect(angleBody?.triggerLine).toBeUndefined()
    await expect(page.locator('text=/new EMEA office opening/i').first()).toBeVisible()
  })

  test('Escape closes the open AnglePicker menu', async ({ page }) => {
    await createTestDraft(page, {
      userId,
      role: 'gtm',
      partial: 'both',
      companyName: 'EscCo',
      campaignId,
    })

    await page.goto(`/campaigns/${campaignId}/drafts`)
    await expect(page.getByText('EscCo').first()).toBeVisible({ timeout: 10_000 })
    await page.getByText('EscCo').first().click()

    // Open the picker — its menu shows the alternate trigger options.
    const pickerTrigger = page.getByRole('button', { name: /raised Series B in March/i })
    await expect(pickerTrigger).toBeVisible({ timeout: 10_000 })
    await pickerTrigger.click()

    // Menu visible while open.
    const menuItem = page.getByRole('button', { name: /hired VP Sales from Stripe/i })
    await expect(menuItem).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menuItem).toBeHidden()
  })
})
