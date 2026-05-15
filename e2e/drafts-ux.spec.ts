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

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'email_draft_1',
    userLeadId: 'lead_1',
    contactId: 'contact_1',
    subject: 'Quick question about Acme',
    body: 'Hi Avery,\n\nYour robots fold laundry.',
    status: 'draft',
    attachmentIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sentAt: null,
    contact: { id: 'contact_1', name: 'Avery Kim', email: 'avery@acme.test', title: 'Founder' },
    customContact: null,
    userLead: {
      id: 'lead_1',
      status: 'SAVED',
      company: { id: 'co_1', name: 'Acme Robotics', domain: 'acme.test' },
    },
    ...overrides,
  }
}

let userId: string
let campaignId: string

test.describe('Drafts UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    const template = await createTestTemplate(page, { name: 'Draft review template' })
    const campaign = await createTestCampaign(page, {
      name: 'Draft review campaign',
      status: 'ACTIVE',
      templateId: template.id,
    })
    campaignId = campaign.id
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('filters ready and needs-review drafts in the campaign drafts table', async ({ page }) => {
    await page.route('**/api/emails**', route =>
      json(route, {
        items: [
          draft(),
          draft({
            id: 'email_draft_2',
            subject: '',
            body: '',
            contact: { id: 'contact_2', name: 'Blake Lee', email: 'blake@beta.test', title: 'CTO' },
          }),
          draft({
            id: 'email_draft_3',
            contact: { id: 'contact_3', name: 'Casey Noemail', email: null, title: 'COO' },
          }),
        ],
        drafts: [
          draft(),
          draft({ id: 'email_draft_2', subject: '', body: '' }),
          draft({ id: 'email_draft_3' }),
        ],
        sent: [],
      }),
    )

    await page.goto(`/campaigns/${campaignId}/drafts`)
    await expect(page.locator('text=/1 ready, 2 need review/i')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /^Ready 1$/i }).click()
    await expect(page.getByText('Avery Kim').first()).toBeVisible()
    await expect(page.getByText('Blake Lee')).toHaveCount(0)

    await page.getByRole('button', { name: /Missing recipient 1/i }).click()
    await expect(page.getByText('Casey Noemail').first()).toBeVisible()
    await expect(page.getByText('Avery Kim')).toHaveCount(0)
  })

  test('edits and saves a draft from the preview panel', async ({ page }) => {
    let patchPayload: any = null
    await page.route('**/api/emails**', route => {
      if (route.request().method() === 'PATCH') {
        patchPayload = route.request().postDataJSON()
        return json(route, { ...draft(), ...patchPayload, updatedAt: new Date().toISOString() })
      }
      return json(route, { items: [draft()], drafts: [draft()], sent: [] })
    })

    await page.goto(`/campaigns/${campaignId}/drafts`)
    await page.getByText('Avery Kim').first().click()
    await page.getByRole('button', { name: /Edit/i }).click()
    await page.getByPlaceholder('Subject line').fill('Updated subject')
    const bodyEditor = page.locator('[aria-label="Draft body"][contenteditable]')
    await bodyEditor.click()
    await bodyEditor.fill('Updated body')
    await page.getByRole('button', { name: /^Save$/i }).click()

    await expect.poll(() => patchPayload?.subject).toBe('Updated subject')
    // Body is rich-editor HTML now ('<p style="...">Updated body</p>') — the
    // contract is that user input reaches the server intact, not that it
    // arrives as bare plain text.
    expect(patchPayload.body).toContain('Updated body')
    await expect(page.locator('text=/Updated subject/i').first()).toBeVisible()
  })

  test('surfaces Gmail connection guidance before sending drafts', async ({ page }) => {
    await page.route('**/api/emails**', route =>
      json(route, { items: [draft()], drafts: [draft()], sent: [] }),
    )
    // Override profile to report Gmail NOT connected
    await page.route('**/api/profile**', route =>
      json(route, {
        profile: {
          onboardingCompleted: true,
          workspaceConfig: { senderName: 'E2E Test User', templateId: null },
          hasClaudeKey: true,
          hasGoogleRefreshToken: false,
        },
      }),
    )

    await page.goto(`/campaigns/${campaignId}/drafts`)
    await expect(
      page.locator('text=/Gmail not connected\\. Connect in Settings\\./i').first(),
    ).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Open Settings/i }).click()
    await expect(page).toHaveURL(/\/settings$/)
  })

  test('refreshes Gmail status and hides the disconnected banner when connected', async ({
    page,
  }) => {
    await page.route('**/api/emails**', route =>
      json(route, { items: [draft()], drafts: [draft()], sent: [] }),
    )
    let profileCalls = 0
    await page.route('**/api/profile**', route => {
      profileCalls += 1
      return json(route, {
        profile: {
          onboardingCompleted: true,
          workspaceConfig: { senderName: 'E2E Test User', templateId: null },
          hasClaudeKey: true,
          hasGoogleRefreshToken: profileCalls > 1,
        },
      })
    })

    await page.goto(`/campaigns/${campaignId}/drafts`)
    await expect(
      page.locator('text=/Gmail not connected\\. Connect in Settings\\./i'),
    ).toHaveCount(0, { timeout: 10_000 })
  })

  test('deletes a selected draft and removes it from the queue', async ({ page }) => {
    let deletedIds: string | null = null
    await page.route('**/api/emails**', route => {
      if (route.request().method() === 'DELETE') {
        deletedIds = new URL(route.request().url()).searchParams.get('ids')
        return json(route, { deleted: deletedIds?.split(',') ?? [] })
      }
      return json(route, { items: [draft()], drafts: [draft()], sent: [] })
    })

    await page.goto(`/campaigns/${campaignId}/drafts`)
    await page.getByLabel(/Select draft for Avery Kim/i).check()
    await page.getByRole('button', { name: /Delete 1/i }).click()
    await page
      .getByRole('dialog', { name: /Delete draft/i })
      .getByRole('button', { name: /^Delete$/i })
      .click()

    await expect.poll(() => deletedIds).toBe('email_draft_1')
    await expect(page.locator('text=/Draft deleted/i')).toBeVisible()
  })

  test('sent email preview is read-only', async ({ page }) => {
    const sentEmail = draft({
      id: 'email_sent_1',
      status: 'sent',
      sentAt: new Date().toISOString(),
    })
    await page.route('**/api/emails**', route =>
      json(route, { items: [sentEmail], drafts: [], sent: [sentEmail] }),
    )

    await page.goto(`/campaigns/${campaignId}/sent`)
    await page.getByText('Avery Kim').first().click()

    await expect(page.locator('text=/^Sent$/').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /^Edit$/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Send$/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Delete draft/i })).toHaveCount(0)
  })
})
