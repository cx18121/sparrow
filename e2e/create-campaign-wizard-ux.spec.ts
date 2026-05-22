import { test, expect, type Route } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestTemplate,
  cleanupTestData,
} from './fixtures/api-mocks'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

let userId: string

test.describe('Create campaign wizard UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    await page.addInitScript(() => {
      localStorage.removeItem('sparrow_wizard_v1')
    })
    await mockApi(page, { audienceQueryResponse: { count: 84, sample: [] } })
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('requires a campaign name before progressing from the first step', async ({ page }) => {
    await page.goto('/dashboard?new=1')
    await expect(page.locator('text=/Name your campaign/i')).toBeVisible({ timeout: 10_000 })

    const continueButton = page.getByRole('button', { name: /Continue/i })
    await expect(continueButton).toBeDisabled()

    await page.getByRole('button', { name: /YC W26 hiring/i }).click()
    await expect(page.getByLabel('Campaign name')).toHaveValue('YC W26 hiring')
    await expect(continueButton).toBeEnabled()
    await continueButton.click()

    await expect(page.locator('text=/Who should Sparrow find\\?/i')).toBeVisible()
  })

  test('shows YC batch choices only for YC-backed audiences and clears stale batch filters', async ({
    page,
  }) => {
    // Override campaign-options to include batches and tags
    await page.route('**/api/campaign-options', route =>
      json(route, {
        industries: [],
        regions: [],
        stages: [],
        batches: ['W26', 'S25', 'W25'],
        tags: {
          signal: [
            { namespaced: 'signal:yc-backed', name: 'YC-backed', count: 42 },
            { namespaced: 'signal:recent-funding', name: 'Recently funded', count: 31 },
            { namespaced: 'signal:multi-source', name: 'Multi-source', count: 50 },
          ],
        },
        hiringCount: 0,
      }),
    )

    let createdPayload: any = null
    await page.route('**/api/campaigns**', route => {
      if (route.request().method() === 'POST') {
        createdPayload = route.request().postDataJSON()
        return json(
          route,
          {
            id: 'cmp_created',
            userId,
            name: createdPayload.name,
            status: createdPayload.status,
            batchSize: 10,
            currentBatch: 0,
            filterTags: createdPayload.filterTags ?? [],
            filterBatch: createdPayload.filterBatch ?? null,
            attachmentIds: [],
            includePreviouslySaved: createdPayload.includePreviouslySaved,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          201,
        )
      }
      return json(route, { items: [] })
    })

    await page.goto('/dashboard?new=1')
    await page.getByLabel('Campaign name').fill('YC infra outreach')
    await page.getByRole('button', { name: /Continue/i }).click()

    await expect(page.getByRole('button', { name: /^W26$/ })).toHaveCount(0)
    await page.getByRole('button', { name: /YC-backed/i }).click()
    await expect(page.getByRole('button', { name: /^W26$/ })).toBeVisible()
    await page.getByRole('button', { name: /^W26$/ }).click()

    await page.getByRole('button', { name: /YC-backed/i }).click()
    await expect(page.getByRole('button', { name: /^W26$/ })).toHaveCount(0)

    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: /No template/i }).click()
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: /Launch \(Active\)/i }).click()

    await expect.poll(() => createdPayload?.name).toBe('YC infra outreach')
    expect(createdPayload.filterTags ?? []).not.toContain('signal:yc-backed')
    // filterBatch is String[] after the 20260522224124 migration. The wizard
    // posts an empty array when no batch is selected (vs null pre-migration).
    expect(createdPayload.filterBatch ?? []).toEqual([])
  })

  test('can save a campaign as paused with a selected template', async ({ page }) => {
    const template = await createTestTemplate(page, { name: 'Cold intro' })

    let createdPayload: any = null
    await page.route('**/api/campaigns**', route => {
      if (route.request().method() === 'POST') {
        createdPayload = route.request().postDataJSON()
        return json(
          route,
          {
            id: 'cmp_paused',
            userId,
            name: createdPayload.name,
            status: createdPayload.status,
            templateId: createdPayload.templateId,
            batchSize: 10,
            currentBatch: 0,
            filterTags: [],
            attachmentIds: [],
            includePreviouslySaved: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          201,
        )
      }
      return json(route, { items: [] })
    })

    await page.goto('/dashboard?new=1')
    await page.getByLabel('Campaign name').fill('Paused launch candidate')
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: new RegExp(template.name) }).click()
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: /Save as Paused/i }).click()

    await expect.poll(() => createdPayload?.status).toBe('PAUSED')
    expect(createdPayload.templateId).toBe(template.id)
  })

  test('shows an audience preview failure without blocking wizard progress', async ({ page }) => {
    await page.route('**/api/audience-query**', route =>
      json(route, { error: 'preview failed' }, 500),
    )

    await page.goto('/dashboard?new=1')
    await page.getByLabel('Campaign name').fill('Preview failure still works')
    await page.getByRole('button', { name: /Continue/i }).click()

    await expect(page.locator('text=/Could not load preview/i')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Continue/i }).click()
    await expect(page.locator('text=/Pick a template/i')).toBeVisible()
  })

  test('wizard exposes dialog ARIA and Escape dismisses it', async ({ page }) => {
    await page.goto('/dashboard?new=1')
    const dialog = page.getByRole('dialog', { name: /Create campaign/i })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('Escape during in-flight submit does not cancel the campaign create', async ({
    page,
  }) => {
    const template = await createTestTemplate(page, { name: 'Cold intro' })

    // Hold the POST open long enough to press Escape while the create is
    // in flight. The Escape handler must respect submitChoice and refuse
    // to dismiss until the request resolves.
    let releasePost: (() => void) | null = null
    const postReleased = new Promise<void>(resolve => {
      releasePost = resolve
    })
    let createdPayload: any = null
    await page.route('**/api/campaigns**', async route => {
      if (route.request().method() === 'POST') {
        createdPayload = route.request().postDataJSON()
        await postReleased
        return json(
          route,
          {
            id: 'cmp_held',
            userId,
            name: createdPayload.name,
            status: createdPayload.status,
            templateId: createdPayload.templateId,
            batchSize: 10,
            currentBatch: 0,
            filterTags: [],
            attachmentIds: [],
            includePreviouslySaved: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          201,
        )
      }
      return json(route, { items: [] })
    })

    await page.goto('/dashboard?new=1')
    const dialog = page.getByRole('dialog', { name: /Create campaign/i })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    await page.getByLabel('Campaign name').fill('Race test')
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: new RegExp(template.name) }).click()
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: /Save as Paused/i }).click()

    // Submit is in flight (POST held by the route mock). Press Escape —
    // wizard should NOT close because submitChoice is set.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    expect(createdPayload?.name).toBe('Race test')

    // Release the POST; wizard naturally closes after success.
    releasePost?.()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
  })
})
