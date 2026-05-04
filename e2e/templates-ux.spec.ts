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
  })
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

test.describe('Templates UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInDemo(page)
  })

  test('creates a template, autosaves subject edits, and previews merged variables', async ({ page }) => {
    const templates = [{ ...SAMPLE_TEMPLATE }]
    let createdPayload: any = null
    let patchPayload: any = null

    await mockApi(page, { templates })
    await page.route('**/api/templates**', async route => {
      const method = route.request().method()
      if (method === 'GET') return json(route, { items: templates })
      if (method === 'POST') {
        createdPayload = route.request().postDataJSON()
        const created = {
          id: 'tpl_created',
          userId: 'demo',
          name: createdPayload.name,
          subject: createdPayload.subject,
          body: createdPayload.body,
          isShared: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        templates.unshift(created)
        return json(route, created, 201)
      }
      if (method === 'PATCH') {
        patchPayload = route.request().postDataJSON()
        const idx = templates.findIndex(t => t.id === patchPayload.id)
        if (idx >= 0) templates[idx] = { ...templates[idx], ...patchPayload, updatedAt: new Date().toISOString() }
        return json(route, templates[idx])
      }
      return json(route, {}, 204)
    })

    await page.goto('/templates')
    await expect(page.getByRole('heading', { name: /Reusable templates/i })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /New template/i }).click()
    await expect(page.getByRole('button', { name: /Create template/i })).toBeDisabled()

    await page.getByPlaceholder('e.g. Cold Intro - Startup Founder').fill('Founder follow-up')
    await page
      .getByRole('dialog', { name: /New template/i })
      .getByPlaceholder('e.g. Quick question about {{company}}')
      .fill('Quick question about {{company}}')
    await page.getByRole('button', { name: /Create template/i }).click()

    await expect.poll(() => createdPayload?.name).toBe('Founder follow-up')
    expect(createdPayload?.body).toBe('<p></p>')
    await expect(page.getByRole('heading', { name: /Founder follow-up/i })).toBeVisible()

    const subjectInput = page.getByPlaceholder('e.g. Quick question about {{company}}').first()
    await expect(subjectInput).toHaveValue('Quick question about {{company}}')
    await subjectInput.fill('Following up on {{company}}')
    await subjectInput.blur()

    await expect.poll(() => patchPayload?.subject).toBe('Following up on {{company}}')

    await page.getByRole('button', { name: /Preview/i }).click()
    await expect(page.locator('text=/Following up on Momentum AI/i').first()).toBeVisible()
  })

  test('search keeps the template list scannable and shows an empty result state', async ({ page }) => {
    await mockApi(page, {
      templates: [
        { ...SAMPLE_TEMPLATE, id: 'tpl_founder', name: 'Founder intro', subject: 'Quick founder note' },
        { ...SAMPLE_TEMPLATE, id: 'tpl_hiring', name: 'Hiring manager', subject: 'Backend internship' },
      ],
    })

    await page.goto('/templates')
    await expect(page.getByRole('heading', { name: /Founder intro/i })).toBeVisible({ timeout: 10_000 })

    await page.getByPlaceholder('Search templates…').fill('hiring')
    await expect(page.getByRole('button', { name: /Hiring manager/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Founder intro/i })).toHaveCount(0)

    await page.getByPlaceholder('Search templates…').fill('does-not-exist')
    await expect(page.locator('text=/No templates match/i')).toBeVisible()
  })

  test('duplicates, renames, and deletes a template through the overflow menu', async ({ page }) => {
    const templates = [{ ...SAMPLE_TEMPLATE }]
    let patchPayload: any = null
    let deletedId: string | null = null

    await mockApi(page, { templates })
    await page.unroute('**/api/templates')
    await page.route('**/api/templates**', async route => {
      const method = route.request().method()
      if (method === 'GET') return json(route, { items: templates })
      if (method === 'POST') {
        const payload = route.request().postDataJSON()
        const created = {
          ...SAMPLE_TEMPLATE,
          ...payload,
          id: 'tpl_copy',
          userId: 'demo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        templates.unshift(created)
        return json(route, created, 201)
      }
      if (method === 'PATCH') {
        patchPayload = route.request().postDataJSON()
        const idx = templates.findIndex(t => t.id === patchPayload.id)
        templates[idx] = { ...templates[idx], ...patchPayload, updatedAt: new Date().toISOString() }
        return json(route, templates[idx])
      }
      if (method === 'DELETE') {
        deletedId = new URL(route.request().url()).searchParams.get('id')
        const idx = templates.findIndex(t => t.id === deletedId)
        if (idx >= 0) templates.splice(idx, 1)
        return route.fulfill({ status: 204, body: '' })
      }
      return json(route, {})
    })

    await page.goto('/templates')
    await expect(page.getByRole('heading', { name: /Cold intro/i })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /More options/i }).click()
    await page.getByRole('button', { name: /Duplicate/i }).click()
    await expect(page.getByRole('heading', { name: /Cold intro \(copy\)/i })).toBeVisible()

    await page.getByRole('button', { name: /More options/i }).click()
    await page.getByRole('button', { name: /Rename/i }).click()
    await page.getByRole('dialog', { name: /Rename template/i }).getByPlaceholder('e.g. Cold Intro - Startup Founder').fill('Investor intro')
    await page.getByRole('button', { name: /^Rename$/i }).click()

    await expect.poll(() => patchPayload?.name).toBe('Investor intro')
    await expect(page.getByRole('heading', { name: /Investor intro/i })).toBeVisible()

    await page.getByRole('button', { name: /More options/i }).click()
    await page.getByRole('button', { name: /^Delete$/i }).click()
    await expect(page.getByRole('dialog', { name: /Delete template/i })).toBeVisible()
    await page.getByRole('dialog', { name: /Delete template/i }).getByRole('button', { name: /^Delete$/i }).click()

    await expect.poll(() => deletedId).toBe('tpl_copy')
  })
})
