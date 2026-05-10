import { test, expect, type Page, type Route } from '@playwright/test'
import { mockApi, signInDemo, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

const CAMPAIGN_ID = 'cmp_drafts_ux'
const CAMPAIGN = {
  id: CAMPAIGN_ID,
  userId: 'demo',
  name: 'Draft review campaign',
  subject: 'Quick question',
  status: 'ACTIVE' as const,
  templateId: SAMPLE_TEMPLATE.id,
  filterTags: [],
  filterRegion: null,
  filterStage: null,
  filterBatch: null,
  filterIsHiring: null,
  filterHeadcountMin: null,
  filterHeadcountMax: null,
  batchSize: 10,
  currentBatch: 0,
  tone: null,
  attachmentIds: [],
  scheduledAt: null,
  template: { id: SAMPLE_TEMPLATE.id, name: SAMPLE_TEMPLATE.name },
  includePreviouslySaved: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
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
    userLead: { id: 'lead_1', status: 'SAVED', company: { id: 'co_1', name: 'Acme Robotics', domain: 'acme.test' } },
    ...overrides,
  }
}

test.describe('Drafts UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInDemo(page)
  })

  test('filters ready and needs-review drafts in the campaign drafts table', async ({ page }) => {
    await mockApi(page, {
      campaigns: [CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      drafts: [
        draft(),
        draft({ id: 'email_draft_2', subject: '', body: '', contact: { id: 'contact_2', name: 'Blake Lee', email: 'blake@beta.test', title: 'CTO' } }),
        draft({ id: 'email_draft_3', contact: { id: 'contact_3', name: 'Casey Noemail', email: null, title: 'COO' } }),
      ],
    })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/drafts`)
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
    await mockApi(page, { campaigns: [CAMPAIGN], templates: [SAMPLE_TEMPLATE], drafts: [draft()] })
    await page.route('**/api/emails**', route => {
      if (route.request().method() === 'PATCH') {
        patchPayload = route.request().postDataJSON()
        return json(route, { ...draft(), ...patchPayload, updatedAt: new Date().toISOString() })
      }
      return json(route, { items: [draft()] })
    })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/drafts`)
    await page.getByText('Avery Kim').first().click()
    await page.getByRole('button', { name: /Edit/i }).click()
    await page.getByPlaceholder('Subject line').fill('Updated subject')
    // Body editor is a contentEditable div with aria-label="Draft body".
    const bodyEditor = page.locator('[aria-label="Draft body"][contenteditable]')
    await bodyEditor.click()
    await bodyEditor.fill('Updated body')
    await page.getByRole('button', { name: /^Save$/i }).click()

    await expect.poll(() => patchPayload?.subject).toBe('Updated subject')
    expect(patchPayload.body).toBe('Updated body')
    await expect(page.locator('text=/Updated subject/i').first()).toBeVisible()
  })

  test('surfaces Gmail connection guidance before sending drafts', async ({ page }) => {
    await mockApi(page, {
      campaigns: [CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      drafts: [draft()],
      profile: { hasGoogleRefreshToken: false },
    })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/drafts`)

    await expect(page.locator('text=/Gmail not connected\\. Connect in Settings\\./i').first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Open Settings/i }).click()
    await expect(page).toHaveURL(/\/settings$/)
  })

  test('refreshes Gmail status and hides the disconnected banner when connected', async ({ page }) => {
    let profileCalls = 0
    await mockApi(page, {
      campaigns: [CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      drafts: [draft()],
      profile: { hasGoogleRefreshToken: false },
    })
    await page.route('**/api/profile', route => {
      profileCalls += 1
      return json(route, {
        profile: {
          onboardingCompleted: true,
          workspaceConfig: { senderName: 'Demo User', templateId: null },
          hasClaudeKey: true,
          hasGoogleRefreshToken: profileCalls > 1,
        },
      })
    })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/drafts`)

    await expect(page.locator('text=/Gmail not connected\\. Connect in Settings\\./i')).toHaveCount(0, { timeout: 10_000 })
  })

  test('deletes a selected draft and removes it from the queue', async ({ page }) => {
    let deletedIds: string | null = null
    await mockApi(page, { campaigns: [CAMPAIGN], templates: [SAMPLE_TEMPLATE], drafts: [draft()] })
    await page.route('**/api/emails**', route => {
      if (route.request().method() === 'DELETE') {
        deletedIds = new URL(route.request().url()).searchParams.get('ids')
        return json(route, { deleted: deletedIds?.split(',') ?? [] })
      }
      return json(route, { items: [draft()] })
    })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/drafts`)
    await page.getByLabel(/Select draft for Avery Kim/i).check()
    await page.getByRole('button', { name: /Delete 1/i }).click()
    await page.getByRole('dialog', { name: /Delete draft/i }).getByRole('button', { name: /^Delete$/i }).click()

    await expect.poll(() => deletedIds).toBe('email_draft_1')
    await expect(page.locator('text=/Draft deleted/i')).toBeVisible()
  })

  test('sent email preview is read-only', async ({ page }) => {
    const sentEmail = draft({
      id: 'email_sent_1',
      status: 'sent',
      sentAt: new Date().toISOString(),
    })
    await mockApi(page, { campaigns: [CAMPAIGN], templates: [SAMPLE_TEMPLATE], sent: [sentEmail] })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/sent`)
    await page.getByText('Avery Kim').first().click()

    await expect(page.locator('text=/^Sent$/').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /^Edit$/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Send$/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Delete draft/i })).toHaveCount(0)
  })
})
