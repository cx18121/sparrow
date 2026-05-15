import { test, expect, type Route } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestCampaign,
  createTestTemplate,
  cleanupTestData,
} from './fixtures/api-mocks'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

let userId: string

test.describe('Settings and workspace UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('saves workspace profile edits and shows success feedback', async ({ page }) => {
    // Profile GET returns seed data; POST captures the payload.
    let profilePost: any = null
    await page.route('**/api/profile**', route => {
      if (route.request().method() === 'POST') {
        profilePost = route.request().postDataJSON()
        return json(route, {
          profile: {
            onboardingCompleted: true,
            workspaceConfig: profilePost.workspaceConfig,
            hasClaudeKey: true,
            hasGoogleRefreshToken: true,
          },
        })
      }
      return json(route, {
        profile: {
          onboardingCompleted: true,
          workspaceConfig: {
            senderName: 'Alex Tester',
            senderCompany: 'Cornell GenAI',
            senderRole: 'Builder',
            resumeText: 'Built outreach tools.',
            templateId: null,
          },
          hasClaudeKey: true,
          hasGoogleRefreshToken: true,
        },
      })
    })

    await page.goto('/settings')
    await page.getByPlaceholder('Jordan Lee').fill('Taylor Student')
    await page.getByRole('button', { name: /Save profile/i }).click()

    await expect.poll(() => profilePost?.workspaceConfig?.senderName).toBe('Taylor Student')
    await expect(page.locator('text=/Profile saved/i')).toBeVisible()
  })

  // Removed: "clamps sending limits and saves default sending settings".
  // The Sending tab no longer exposes Daily send limit / Delay between sends
  // controls — `sendingLimits` was retired from the workspace config. If the
  // feature returns, restore a test that asserts clamp behavior through the
  // server payload, not by matching label text.

  test('saves campaign settings edits through the workspace editor', async ({ page }) => {
    const template = await createTestTemplate(page, { name: 'Cold intro' })
    const campaign = await createTestCampaign(page, {
      name: 'Settings UX campaign',
      status: 'ACTIVE',
      templateId: template.id,
    })

    let patchPayload: any = null
    await page.route('**/api/campaign-options', route =>
      json(route, {
        industries: [],
        regions: [],
        stages: [],
        batches: [],
        tags: {
          signal: [
            { namespaced: 'signal:yc-backed', name: 'YC-backed', count: 25 },
            { namespaced: 'signal:recent-funding', name: 'Recently funded', count: 22 },
          ],
        },
        hiringCount: 0,
      }),
    )
    await page.route('**/api/campaigns**', route => {
      if (route.request().method() === 'PATCH') {
        patchPayload = route.request().postDataJSON()
        return json(route, {
          ...campaign,
          ...patchPayload,
          status: (patchPayload.status || campaign.status).toUpperCase(),
          updatedAt: new Date().toISOString(),
        })
      }
      return json(route, { items: [campaign] })
    })

    await page.goto(`/campaigns/${campaign.id}/settings`)
    await page.locator('input.input').first().fill('Updated campaign settings')
    await page.locator('select.select').nth(1).selectOption('paused')
    await page.getByRole('button', { name: /Hiring only/i }).click()
    await page.getByRole('button', { name: /YC-backed/i }).click()
    await page.getByRole('button', { name: /Save changes/i }).click()

    await expect.poll(() => patchPayload?.name).toBe('Updated campaign settings')
    expect(patchPayload.status).toBe('PAUSED')
    expect(patchPayload.filterIsHiring).toBe(true)
    expect(patchPayload.filterTags).toContain('signal:yc-backed')
  })

  test('requires campaign name before saving workspace settings', async ({ page }) => {
    const campaign = await createTestCampaign(page, {
      name: 'Settings UX campaign',
      status: 'ACTIVE',
    })

    await page.goto(`/campaigns/${campaign.id}/settings`)
    await page.locator('input.input').first().fill('')

    await expect(page.locator('text=/Campaign name is required to save/i')).toBeVisible()
    await expect(page.getByRole('button', { name: /Save changes/i })).toBeDisabled()
  })
})
