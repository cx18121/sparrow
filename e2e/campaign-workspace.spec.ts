import { test, expect } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestCampaign,
  createTestTemplate,
  cleanupTestData,
  SAMPLE_COMPANY,
} from './fixtures/api-mocks'

// Phase 3 — campaign workspace shell.
//   - Clicking a campaign card on Home navigates to /campaigns/:id/overview
//   - The persistent header shows the campaign name + status
//   - All five sub-tabs (overview / leads / drafts / sent / settings) are
//     reachable and don't crash
//   - Optimistic temp-id campaign cards are rendered as non-clickable

let userId: string

test.describe('Campaign workspace shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    await mockApi(page)
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('clicking a campaign card lands on /:id/overview and renders all sub-tabs', async ({
    page,
  }) => {
    const template = await createTestTemplate(page, { name: 'Cold intro' })
    const campaign = await createTestCampaign(page, {
      name: 'Series A AI infra hiring',
      status: 'ACTIVE',
      templateId: template.id,
    })

    await page.goto('/dashboard')
    await expect(page.locator('text=/Series A AI infra hiring/').first()).toBeVisible({
      timeout: 10_000,
    })

    // Click the campaign card → land on workspace overview
    await page.locator('text=/Series A AI infra hiring/').first().click()
    await expect(page).toHaveURL(
      new RegExp(`/campaigns/${campaign.id}/overview`),
      { timeout: 5_000 },
    )

    // Persistent header shows the name + ACTIVE badge
    const header = page.locator('header').filter({ hasText: 'Series A AI infra hiring' }).first()
    await expect(header).toBeVisible()
    await expect(header.locator('text=/active/i').first()).toBeVisible()

    // Each sub-tab is reachable without errors
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))

    for (const tab of ['Leads', 'Drafts', 'Sent', 'Settings', 'Overview']) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      await expect(page).toHaveURL(
        new RegExp(`/campaigns/${campaign.id}/${tab.toLowerCase()}`),
      )
    }
    expect(errors, `Errors visiting sub-tabs: ${errors.join(', ')}`).toHaveLength(0)

    // Back-to-Home link works
    await page.locator('a', { hasText: 'Home' }).first().click()
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('refresh into a workspace URL resolves to the workspace, not Home', async ({ page }) => {
    const template = await createTestTemplate(page, { name: 'Cold intro' })
    const campaign = await createTestCampaign(page, {
      name: 'Series A AI infra hiring',
      status: 'ACTIVE',
      templateId: template.id,
    })

    await page.goto(`/campaigns/${campaign.id}/sent`)
    await expect(page).toHaveURL(
      new RegExp(`/campaigns/${campaign.id}/sent`),
      { timeout: 10_000 },
    )
    // The workspace header should resolve, not Home.
    const header = page.locator('header').filter({ hasText: 'Series A AI infra hiring' }).first()
    await expect(header).toBeVisible()
    await expect(page.locator('text=/per-campaign send log/i')).toHaveCount(0)
  })

  test('unknown campaign id renders a not-found card instead of crashing', async ({ page }) => {
    await page.goto('/campaigns/cmp_does_not_exist/overview')
    await expect(page.locator('text=/Campaign not found/i').first()).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Drafts sub-tab shows the empty state when no drafts exist for this campaign (Phase 4b)', async ({
    page,
  }) => {
    const template = await createTestTemplate(page, { name: 'Cold intro' })
    const campaign = await createTestCampaign(page, {
      name: 'Draft test campaign',
      status: 'ACTIVE',
      templateId: template.id,
    })

    await page.goto(`/campaigns/${campaign.id}/drafts`)
    await expect(page.locator('text=/No drafts ready for review/i').first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator('text=/scoped to just this campaign/i')).toHaveCount(0)
  })

  test('Drafts sub-tab renders campaign-scoped drafts when seeded (Phase 4b)', async ({ page }) => {
    const template = await createTestTemplate(page, { name: 'Cold intro' })
    const campaign = await createTestCampaign(page, {
      name: 'Draft test campaign',
      status: 'ACTIVE',
      templateId: template.id,
    })

    // Seed a draft email via mockApi's generate endpoint mock and the emails API.
    // Since we can't easily create a draft without a full lead, we mock the
    // emails endpoint for this campaign to return our seeded draft.
    const draft = {
      id: 'email_draft_1',
      userLeadId: null,
      contactId: null,
      customContactId: null,
      subject: 'Quick question about Acme',
      body: 'Hi Avery, your robots fold laundry.',
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
    }
    await page.route('**/api/emails**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [draft], drafts: [draft], sent: [] }),
      }),
    )

    await page.goto(`/campaigns/${campaign.id}/drafts`)
    await expect(page.locator('text=Avery Kim').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=Quick question about Acme').first()).toBeVisible()
  })

  test('Sent sub-tab shows the campaign-scoped empty state when nothing sent (Phase 4c)', async ({
    page,
  }) => {
    const campaign = await createTestCampaign(page, {
      name: 'Sent test campaign',
      status: 'ACTIVE',
    })

    await page.goto(`/campaigns/${campaign.id}/sent`)
    await expect(
      page.locator('text=/Nothing sent from this campaign yet/i').first(),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.segmented-control')).toHaveCount(0)
  })

  test('Sent sub-tab renders campaign-scoped sent emails when seeded (Phase 4c)', async ({
    page,
  }) => {
    const campaign = await createTestCampaign(page, {
      name: 'Sent test campaign',
      status: 'ACTIVE',
    })

    const sentAt = new Date().toISOString()
    const sentEmail = {
      id: 'email_sent_1',
      userLeadId: 'lead_1',
      contactId: 'contact_1',
      subject: 'Quick question about Acme',
      body: 'Hi Avery, your robots fold laundry.',
      status: 'sent',
      attachmentIds: [],
      createdAt: sentAt,
      updatedAt: sentAt,
      sentAt,
      contact: { id: 'contact_1', name: 'Avery Kim', email: 'avery@acme.test', title: 'Founder' },
      customContact: null,
      userLead: {
        id: 'lead_1',
        status: 'CONTACTED',
        company: { id: 'co_1', name: 'Acme Robotics', domain: 'acme.test' },
      },
    }
    await page.route('**/api/emails**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [sentEmail], drafts: [], sent: [sentEmail] }),
      }),
    )

    await page.goto(`/campaigns/${campaign.id}/sent`)
    await expect(page.locator('text=Avery Kim').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=Quick question about Acme').first()).toBeVisible()
    await expect(page.locator('text=/^Sent$/').first()).toBeVisible()
    // No bulk Send button should appear even after the row is checked.
    const checkbox = page.locator('input[type="checkbox"]').nth(1)
    await checkbox.check()
    await expect(page.getByRole('button', { name: /^Send 1$/ })).toHaveCount(0)
  })

  test('Leads sub-tab mounts Discover and shows companies (Phase 4a)', async ({ page }) => {
    const campaign = await createTestCampaign(page, {
      name: 'Lead discovery campaign',
      status: 'ACTIVE',
    })

    await mockApi(page, {
      companiesResponse: {
        items: [SAMPLE_COMPANY],
        nextCursor: null,
        seenTotal: 0,
        usingFallback: false,
      },
    })

    await page.goto(`/campaigns/${campaign.id}/leads`)
    await expect(page.locator(`text=${SAMPLE_COMPANY.name}`).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole('button', { name: /Find contacts/i }).first()).toBeVisible()
    await expect(page.locator('text=/Browsing for/i')).toHaveCount(0)
  })

  test('Find contacts modal hints when the server fell back to a no-title search (Bug 08)', async ({
    page,
  }) => {
    const campaign = await createTestCampaign(page, {
      name: 'Lead discovery campaign',
      status: 'ACTIVE',
    })

    await mockApi(page, {
      companiesResponse: {
        items: [SAMPLE_COMPANY],
        nextCursor: null,
        seenTotal: 0,
        usingFallback: false,
      },
    })

    await page.route('**/api/apollo-search', route => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            previews: [
              {
                id: 'p1',
                firstName: 'Bob',
                lastNameObfuscated: 'K***',
                title: 'Product Manager',
                hasEmail: false,
                companyName: SAMPLE_COMPANY.name,
              },
            ],
            companyId: SAMPLE_COMPANY.id,
            usedFallback: true,
          }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ revealed: false }),
      })
    })

    await page.goto(`/campaigns/${campaign.id}/leads`)
    await page.getByRole('button', { name: /Find contacts/i }).first().click()
    await expect(page.locator('text=Bob').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=/no senior matches, showing all/i')).toBeVisible()
  })

  test('Settings sub-tab renders inline editor with campaign data (Phase 4d)', async ({ page }) => {
    const template = await createTestTemplate(page, { name: 'Cold intro' })
    const campaign = await createTestCampaign(page, {
      name: 'Settings UX campaign',
      status: 'ACTIVE',
      templateId: template.id,
    })

    await page.goto(`/campaigns/${campaign.id}/settings`)
    await expect(page.locator('text=/Moves over from the legacy modal/i')).toHaveCount(0)
    await expect(page.locator('text=/Campaign settings/i').first()).toBeVisible({
      timeout: 10_000,
    })
    const nameInput = page.locator('input.input').first()
    await expect(nameInput).toHaveValue(campaign.name)
    // Save bar appears only when dirty.
    await expect(page.getByRole('button', { name: /Save changes/i })).toHaveCount(0)
    await nameInput.fill(`${campaign.name} (edited)`)
    await expect(page.getByRole('button', { name: /Save changes/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Discard/i })).toBeVisible()
    // Discard reverts and hides the save bar.
    await page.getByRole('button', { name: /Discard/i }).click()
    await expect(nameInput).toHaveValue(campaign.name)
    await expect(page.getByRole('button', { name: /Save changes/i })).toHaveCount(0)
  })

  test('Drafts sub-tab surfaces a Claude-key warning when the profile has no key (Bug 09)', async ({
    page,
  }) => {
    const campaign = await createTestCampaign(page, {
      name: 'Drafts warning campaign',
      status: 'ACTIVE',
    })

    // Override profile to report no Claude key
    await page.route('**/api/profile**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: {
            onboardingCompleted: true,
            workspaceConfig: { senderName: 'E2E Test User', templateId: null },
            hasClaudeKey: false,
            hasGoogleRefreshToken: true,
          },
        }),
      }),
    )

    await page.goto(`/campaigns/${campaign.id}/drafts`)
    await expect(
      page.locator('text=/Draft generation is unavailable/i').first(),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('link', { name: /Open Settings/i })).toBeVisible()
  })

  test('Drafts sub-tab hides the Claude-key warning when a key is configured', async ({ page }) => {
    const campaign = await createTestCampaign(page, {
      name: 'Drafts no-warning campaign',
      status: 'ACTIVE',
    })

    await page.goto(`/campaigns/${campaign.id}/drafts`)
    await expect(page.locator('text=/No drafts ready for review/i').first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator('text=/Draft generation is unavailable/i')).toHaveCount(0)
  })

  test('Settings sub-tab Delete confirms and navigates back to Home (Phase 4d)', async ({
    page,
  }) => {
    const campaign = await createTestCampaign(page, {
      name: 'Delete me campaign',
      status: 'ACTIVE',
    })

    await page.goto(`/campaigns/${campaign.id}/settings`)
    await page.getByRole('button', { name: /Delete campaign/i }).click()
    await expect(page.locator(`text=/${campaign.name}/`).first()).toBeVisible()
    await page.locator('.btn-danger').filter({ hasText: /^Delete$/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5_000 })
  })

  test('optimistic temp-id campaign card is rendered as non-clickable', async ({ page }) => {
    // This test manipulates the cache directly via a route override to simulate
    // an optimistic entry — no real data needed.
    await page.route('**/api/campaigns**', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'temp-pending-123',
                userId,
                name: 'Optimistic pending',
                status: 'DRAFT',
                filterTags: [],
                attachmentIds: [],
                batchSize: 10,
                currentBatch: 0,
                includePreviouslySaved: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
        })
      }
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'cmp_new', name: 'New', status: 'DRAFT' }),
      })
    })

    await page.goto('/dashboard')
    const card = page.getByRole('button', { name: /Optimistic pending/i }).first()
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toBeDisabled()
    await expect(page.locator('text=/Saving…/').first()).toBeVisible()
  })
})
