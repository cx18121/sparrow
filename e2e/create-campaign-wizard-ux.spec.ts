import { test, expect, type Page, type Route } from '@playwright/test'
import { mockApi, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

async function signInDemo(page: Page) {
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
    localStorage.removeItem('sparrow_wizard_v1')
  })
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

test.describe('Create campaign wizard UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInDemo(page)
  })

  test('requires a campaign name before progressing from the first step', async ({ page }) => {
    await mockApi(page, { templates: [SAMPLE_TEMPLATE] })

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

  test('shows YC batch choices only for YC-backed audiences and clears stale batch filters', async ({ page }) => {
    let createdPayload: any = null
    await mockApi(page, { templates: [SAMPLE_TEMPLATE] })
    await page.unroute('**/api/campaign-options')
    await page.unroute('**/api/campaigns**')
    await page.route('**/api/campaign-options', route => json(route, {
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
    }))
    await page.route('**/api/campaigns**', route => {
      if (route.request().method() === 'POST') {
        createdPayload = route.request().postDataJSON()
        return json(route, {
          id: 'cmp_created',
          userId: 'demo',
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
        }, 201)
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
    expect(createdPayload.filterBatch ?? null).toBeNull()
  })

  test('can save a campaign as paused with a selected template', async ({ page }) => {
    let createdPayload: any = null
    await mockApi(page, { templates: [SAMPLE_TEMPLATE] })
    await page.unroute('**/api/campaigns**')
    await page.route('**/api/campaigns**', route => {
      if (route.request().method() === 'POST') {
        createdPayload = route.request().postDataJSON()
        return json(route, {
          id: 'cmp_paused',
          userId: 'demo',
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
        }, 201)
      }
      return json(route, { items: [] })
    })

    await page.goto('/dashboard?new=1')
    await page.getByLabel('Campaign name').fill('Paused launch candidate')
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: new RegExp(SAMPLE_TEMPLATE.name) }).click()
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: /Save as Paused/i }).click()

    await expect.poll(() => createdPayload?.status).toBe('PAUSED')
    expect(createdPayload.templateId).toBe(SAMPLE_TEMPLATE.id)
  })

  test('shows an audience preview failure without blocking wizard progress', async ({ page }) => {
    await mockApi(page, { templates: [SAMPLE_TEMPLATE] })
    await page.unroute('**/api/audience-query')
    await page.route('**/api/audience-query', route => json(route, { error: 'preview failed' }, 500))

    await page.goto('/dashboard?new=1')
    await page.getByLabel('Campaign name').fill('Preview failure still works')
    await page.getByRole('button', { name: /Continue/i }).click()

    await expect(page.locator('text=/Could not load preview/i')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Continue/i }).click()
    await expect(page.locator('text=/Pick a template/i')).toBeVisible()
  })
})
