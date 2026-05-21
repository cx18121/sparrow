import { test, expect, type Route } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestTemplate,
  cleanupTestData,
  SAMPLE_TEMPLATE,
} from './fixtures/api-mocks'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

let userId: string

test.describe('Templates UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('creates a template, autosaves subject edits, and previews merged variables', async ({
    page,
  }) => {
    // Start with an existing template so the list isn't empty.
    const existing = await createTestTemplate(page, {
      name: SAMPLE_TEMPLATE.name,
      subject: SAMPLE_TEMPLATE.subject,
      body: SAMPLE_TEMPLATE.body,
    })

    // Use a stateful in-memory list to track creates + patches without hitting
    // the real API for this specific shape test.
    const templates = [{ ...existing }]
    let createdPayload: any = null
    let patchPayload: any = null

    await page.route('**/api/templates**', async route => {
      const method = route.request().method()
      if (method === 'GET') return json(route, { items: templates })
      if (method === 'POST') {
        createdPayload = route.request().postDataJSON()
        const created = {
          id: 'tpl_created',
          userId,
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
        if (idx >= 0)
          templates[idx] = { ...templates[idx], ...patchPayload, updatedAt: new Date().toISOString() }
        return json(route, templates[idx])
      }
      return json(route, {}, 204)
    })

    await page.goto('/templates')
    await expect(page.getByRole('heading', { name: /Reusable templates/i })).toBeVisible({
      timeout: 10_000,
    })

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
    await expect(page.locator('text=/Following up on Anthropic/i').first()).toBeVisible()
  })

  test('search keeps the template list scannable and shows an empty result state', async ({
    page,
  }) => {
    // Create two real templates.
    await createTestTemplate(page, {
      name: 'Founder intro',
      subject: 'Quick founder note',
      body: '<p>Hi</p>',
    })
    await createTestTemplate(page, {
      name: 'Hiring manager',
      subject: 'Backend internship',
      body: '<p>Hi</p>',
    })

    await page.goto('/templates')
    await expect(page.getByRole('button', { name: /Founder intro/i }).first()).toBeVisible({
      timeout: 10_000,
    })

    await page.getByPlaceholder('Search templates…').fill('hiring')
    await expect(page.getByRole('button', { name: /Hiring manager/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Founder intro/i })).toHaveCount(0)

    await page.getByPlaceholder('Search templates…').fill('does-not-exist')
    await expect(page.locator('text=/No templates match/i')).toBeVisible()
  })

  test('duplicates, renames, and deletes a template through the overflow menu', async ({ page }) => {
    const initial = await createTestTemplate(page, {
      name: 'Cold intro',
      subject: SAMPLE_TEMPLATE.subject,
      body: SAMPLE_TEMPLATE.body,
    })

    const templates = [{ ...initial }]
    let patchPayload: any = null
    let deletedId: string | null = null

    await page.route('**/api/templates**', async route => {
      const method = route.request().method()
      if (method === 'GET') return json(route, { items: templates })
      if (method === 'POST') {
        const payload = route.request().postDataJSON()
        const created = {
          ...initial,
          ...payload,
          id: 'tpl_copy',
          userId,
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
    await expect(page.getByRole('heading', { name: /Cold intro/i })).toBeVisible({
      timeout: 10_000,
    })

    await page.getByRole('button', { name: /More options/i }).click()
    await page.getByRole('button', { name: /Duplicate/i }).click()
    await expect(page.getByRole('heading', { name: /Cold intro \(copy\)/i })).toBeVisible()

    await page.getByRole('button', { name: /More options/i }).click()
    await page.getByRole('button', { name: /Rename/i }).click()
    await page
      .getByRole('dialog', { name: /Rename template/i })
      .getByPlaceholder('e.g. Cold Intro - Startup Founder')
      .fill('Investor intro')
    await page.getByRole('button', { name: /^Rename$/i }).click()

    await expect.poll(() => patchPayload?.name).toBe('Investor intro')
    await expect(page.getByRole('heading', { name: /Investor intro/i })).toBeVisible()

    await page.getByRole('button', { name: /More options/i }).click()
    await page.getByRole('button', { name: /^Delete$/i }).click()
    await expect(page.getByRole('dialog', { name: /Delete template/i })).toBeVisible()
    await page
      .getByRole('dialog', { name: /Delete template/i })
      .getByRole('button', { name: /^Delete$/i })
      .click()

    await expect.poll(() => deletedId).toBe('tpl_copy')
  })

  // Pins ADR-0005 merge-tag coverage in the editor. Per-role default
  // templates ship with {{trigger_line}} / {{proof_of_motion}} (GTM) and
  // {{inflection_line}} / {{system_built}} (ops) baked into the body —
  // before this work, those rendered as literal "{{...}}" in the preview
  // because PREVIEW_SAMPLE + fillVariables only covered the eng pair, and
  // the editor chip toolbar only inserted feature_line + fit_angle. The
  // test asserts both the substitution and the chip surface.
  test('previews and inserts all six per-role personalization merge tags (ADR-0005)', async ({ page }) => {
    // Seed a template that references every personalization tag we ship,
    // so the preview path is forced to substitute each one.
    const body = [
      '<p>Hi {{first_name}},</p>',
      '<p>Eng: {{feature_line}} | {{fit_angle}}.</p>',
      '<p>GTM: {{trigger_line}} | {{proof_of_motion}}.</p>',
      '<p>Ops: {{inflection_line}} | {{system_built}}.</p>',
    ].join('')
    const seeded = await createTestTemplate(page, {
      name: 'All-tags template',
      subject: 'For {{company}}',
      body,
    })

    await page.route('**/api/templates**', route =>
      json(route, { items: [seeded] })
    )

    await page.goto('/templates')
    await page.getByRole('button', { name: /All-tags template/i }).click()
    await page.getByRole('button', { name: /Preview/i }).click()

    // Each personalization tag's sample value comes from PREVIEW_SAMPLE.
    // company-side values are Anthropic-shaped; candidate-side fall back
    // to "your background" so the rendered paragraph reads naturally.
    await expect(page.locator('text=/Eng: claude code agentic coding \\| your background/i')).toBeVisible()
    await expect(page.locator("text=/GTM: Anthropic's \\$4B Amazon round \\| your background/i")).toBeVisible()
    await expect(page.locator("text=/Ops: Anthropic's hiring push across go-to-market \\| your background/i")).toBeVisible()

    // No literal merge-tag braces should survive substitution. Failure here
    // means PREVIEW_SAMPLE / fillVariables / the role's regex pair drifted.
    const previewText = await page.locator('main, body').first().innerText()
    expect(previewText).not.toMatch(/\{\{(feature_line|fit_angle|trigger_line|proof_of_motion|inflection_line|system_built)\}\}/)

    // Editor chip palette must offer every personalization tag so authors
    // of GTM/ops templates can insert them without typing braces by hand.
    await page.getByRole('button', { name: 'Template', exact: true }).click()
    for (const tag of [
      '{{feature_line}}',
      '{{fit_angle}}',
      '{{trigger_line}}',
      '{{proof_of_motion}}',
      '{{inflection_line}}',
      '{{system_built}}',
    ]) {
      await expect(page.getByRole('button', { name: tag, exact: true })).toBeVisible()
    }
  })
})
