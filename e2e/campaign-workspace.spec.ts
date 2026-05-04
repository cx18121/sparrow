import { test, expect } from '@playwright/test'
import { mockApi, SAMPLE_COMPANY, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

// Phase 3 — campaign workspace shell.
//   - Clicking a campaign card on Home navigates to /campaigns/:id/overview
//   - The persistent header shows the campaign name + status
//   - All five sub-tabs (overview / leads / drafts / sent / settings) are
//     reachable and don't crash
//   - Optimistic temp-id campaign cards are rendered as non-clickable

async function signInDemo(page: import('@playwright/test').Page) {
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

const CAMPAIGN_ID = 'cmp_workspace_1'
const SAMPLE_CAMPAIGN = {
  id: CAMPAIGN_ID,
  userId: 'demo',
  name: 'Series A AI infra hiring',
  subject: 'Quick question',
  status: 'ACTIVE' as const,
  templateId: SAMPLE_TEMPLATE.id,
  filterTags: ['stage:series-a'],
  filterRegion: null,
  filterStage: null,
  filterBatch: null,
  filterIsHiring: null,
  filterHeadcountMin: null,
  filterHeadcountMax: null,
  batchSize: 10,
  currentBatch: 1,
  tone: null,
  attachmentIds: [],
  scheduledAt: null,
  template: { id: SAMPLE_TEMPLATE.id, name: SAMPLE_TEMPLATE.name },
  includePreviouslySaved: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

test.describe('Campaign workspace shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInDemo(page)
  })

  test('clicking a campaign card lands on /:id/overview and renders all sub-tabs', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })

    await page.goto('/dashboard')
    await expect(page.locator('text=/Series A AI infra hiring/').first()).toBeVisible({ timeout: 10_000 })

    // Click the campaign card → land on workspace overview
    await page.locator('text=/Series A AI infra hiring/').first().click()
    await expect(page).toHaveURL(/\/campaigns\/cmp_workspace_1\/overview/, { timeout: 5_000 })

    // Persistent header shows the name + ACTIVE badge
    const header = page.locator('header').filter({ hasText: 'Series A AI infra hiring' }).first()
    await expect(header).toBeVisible()
    await expect(header.locator('text=/active/i').first()).toBeVisible()

    // Overview shows the audience pill we configured
    await expect(page.locator('text=/series-a/i').first()).toBeVisible()

    // Each sub-tab is reachable without errors
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))

    for (const tab of ['Leads', 'Drafts', 'Sent', 'Settings', 'Overview']) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/campaigns/cmp_workspace_1/${tab.toLowerCase()}`))
    }
    expect(errors, `Errors visiting sub-tabs: ${errors.join(', ')}`).toHaveLength(0)

    // Back-to-Home link works
    await page.locator('a', { hasText: 'Home' }).first().click()
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('refresh into a workspace URL resolves to the workspace, not Home', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })
    await page.goto('/campaigns/cmp_workspace_1/sent')
    await expect(page).toHaveURL(/\/campaigns\/cmp_workspace_1\/sent/, { timeout: 10_000 })
    // The workspace header should resolve, not Home — and the placeholder
    // coming-soon copy from before 4c must be gone.
    const header = page.locator('header').filter({ hasText: 'Series A AI infra hiring' }).first()
    await expect(header).toBeVisible()
    await expect(page.locator('text=/per-campaign send log/i')).toHaveCount(0)
  })

  test('unknown campaign id renders a not-found card instead of crashing', async ({ page }) => {
    await mockApi(page, { campaigns: [], templates: [] })
    await page.goto('/campaigns/cmp_does_not_exist/overview')
    await expect(page.locator('text=/Campaign not found/i').first()).toBeVisible({ timeout: 10_000 })
  })

  test('Drafts sub-tab shows the empty state when no drafts exist for this campaign (Phase 4b)', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      drafts: [],
    })
    await page.goto('/campaigns/cmp_workspace_1/drafts')
    // Real DraftsTab is mounted now (not a placeholder). Empty state copy
    // comes from DraftsTab's EmptyState — "No drafts ready for review" only
    // renders if DraftsTab actually fetched and got an empty result.
    await expect(page.locator('text=/No drafts ready for review/i').first()).toBeVisible({ timeout: 10_000 })
    // The placeholder Coming-Soon card from Phase 4a's stub is gone.
    await expect(page.locator('text=/scoped to just this campaign/i')).toHaveCount(0)
  })

  test('Drafts sub-tab renders campaign-scoped drafts when seeded (Phase 4b)', async ({ page }) => {
    const draft = {
      id: 'email_draft_1',
      userLeadId: 'lead_1',
      contactId: 'contact_1',
      subject: 'Quick question about Acme',
      body: 'Hi Avery, your robots fold laundry.',
      status: 'draft',
      attachmentIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sentAt: null,
      contact: { id: 'contact_1', name: 'Avery Kim', email: 'avery@acme.test', title: 'Founder' },
      customContact: null,
      userLead: { id: 'lead_1', status: 'SAVED', company: { id: 'co_1', name: 'Acme Robotics', domain: 'acme.test' } },
    }
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      drafts: [draft],
    })
    await page.goto('/campaigns/cmp_workspace_1/drafts')
    // The seeded draft renders — recipient + subject visible in the row.
    await expect(page.locator('text=Avery Kim').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=Quick question about Acme').first()).toBeVisible()
  })

  test('Sent sub-tab shows the campaign-scoped empty state when nothing sent (Phase 4c)', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      sent: [],
    })
    await page.goto('/campaigns/cmp_workspace_1/sent')
    // Workspace-mode copy: scoped to "this campaign" rather than the global one.
    await expect(page.locator('text=/Nothing sent from this campaign yet/i').first()).toBeVisible({ timeout: 10_000 })
    // Inner Drafts/Sent segmented control is hidden because lockedTab is set —
    // the workspace URL is the source of truth for which list to show.
    await expect(page.locator('.segmented-control')).toHaveCount(0)
  })

  test('Sent sub-tab renders campaign-scoped sent emails when seeded (Phase 4c)', async ({ page }) => {
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
      userLead: { id: 'lead_1', status: 'CONTACTED', company: { id: 'co_1', name: 'Acme Robotics', domain: 'acme.test' } },
    }
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      sent: [sentEmail],
    })
    await page.goto('/campaigns/cmp_workspace_1/sent')
    // The seeded sent email renders.
    await expect(page.locator('text=Avery Kim').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=Quick question about Acme').first()).toBeVisible()
    // And the per-row Send/Delete actions are gone — sent rows show a "Sent" badge.
    await expect(page.locator('text=/^Sent$/').first()).toBeVisible()
    // No bulk Send button should appear even after the row is checked.
    const checkbox = page.locator('input[type="checkbox"]').nth(1)
    await checkbox.check()
    await expect(page.getByRole('button', { name: /^Send 1$/ })).toHaveCount(0)
  })

  test('Leads sub-tab mounts Discover and shows companies (Phase 4a)', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      companies: [SAMPLE_COMPANY],
    })
    await page.goto('/campaigns/cmp_workspace_1/leads')
    // The Discover surface renders the sample company plus its Find contacts CTA.
    await expect(page.locator(`text=${SAMPLE_COMPANY.name}`).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /Find contacts/i }).first()).toBeVisible()
    // Phase 4e dropped the in-page "Browsing for X" banner — the workspace
    // header (campaign name + status badge) above already conveys the scope.
    await expect(page.locator('text=/Browsing for/i')).toHaveCount(0)
  })

  test('Find contacts modal hints when the server fell back to a no-title search (Bug 08)', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      companies: [SAMPLE_COMPANY],
    })
    await page.route('**/api/apollo-search', route => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            previews: [{ id: 'p1', firstName: 'Bob', lastNameObfuscated: 'K***', title: 'Product Manager', hasEmail: false, companyName: SAMPLE_COMPANY.name }],
            companyId: SAMPLE_COMPANY.id,
            usedFallback: true,
          }),
        })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revealed: false }) })
    })

    await page.goto('/campaigns/cmp_workspace_1/leads')
    await page.getByRole('button', { name: /Find contacts/i }).first().click()
    // Modal opens with the preview and the broader-search hint.
    await expect(page.locator('text=Bob').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=/no senior matches, showing all/i')).toBeVisible()
  })

  test('Settings sub-tab renders inline editor with campaign data (Phase 4d)', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })
    await page.goto('/campaigns/cmp_workspace_1/settings')
    // The placeholder Coming-Soon copy from before 4d must be gone.
    await expect(page.locator('text=/Moves over from the legacy modal/i')).toHaveCount(0)
    // Header + name input prefilled from the campaign.
    await expect(page.locator('text=/Campaign settings/i').first()).toBeVisible({ timeout: 10_000 })
    const nameInput = page.locator('input.input').first()
    await expect(nameInput).toHaveValue(SAMPLE_CAMPAIGN.name)
    // Save bar appears only when dirty.
    await expect(page.getByRole('button', { name: /Save changes/i })).toHaveCount(0)
    await nameInput.fill(`${SAMPLE_CAMPAIGN.name} (edited)`)
    await expect(page.getByRole('button', { name: /Save changes/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Discard/i })).toBeVisible()
    // Discard reverts and hides the save bar.
    await page.getByRole('button', { name: /Discard/i }).click()
    await expect(nameInput).toHaveValue(SAMPLE_CAMPAIGN.name)
    await expect(page.getByRole('button', { name: /Save changes/i })).toHaveCount(0)
  })

  test('Drafts sub-tab surfaces a Claude-key warning when the profile has no key (Bug 09)', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      drafts: [],
      profile: { hasClaudeKey: false },
    })
    await page.goto('/campaigns/cmp_workspace_1/drafts')
    // Banner copy + Settings link must be visible alongside the empty drafts state.
    await expect(page.locator('text=/Draft generation is unavailable/i').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('link', { name: /Open Settings/i })).toBeVisible()
  })

  test('Drafts sub-tab hides the Claude-key warning when a key is configured', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      drafts: [],
      // hasClaudeKey defaults to true in the fixture — no override needed.
    })
    await page.goto('/campaigns/cmp_workspace_1/drafts')
    await expect(page.locator('text=/No drafts ready for review/i').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=/Draft generation is unavailable/i')).toHaveCount(0)
  })

  test('Settings sub-tab Delete confirms and navigates back to Home (Phase 4d)', async ({ page }) => {
    await mockApi(page, {
      campaigns: [SAMPLE_CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
    })
    await page.goto('/campaigns/cmp_workspace_1/settings')
    await page.getByRole('button', { name: /Delete campaign/i }).click()
    // Confirm dialog appears with the campaign name in the body.
    await expect(page.locator(`text=/${SAMPLE_CAMPAIGN.name}/`).first()).toBeVisible()
    // Confirm — the danger button in the modal is the second "Delete" surface.
    await page.locator('.btn-danger').filter({ hasText: /^Delete$/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5_000 })
  })

  test('optimistic temp-id campaign card is rendered as non-clickable', async ({ page }) => {
    const tempCampaign = { ...SAMPLE_CAMPAIGN, id: 'temp-pending-123', name: 'Optimistic pending' }
    await mockApi(page, {
      campaigns: [tempCampaign],
      templates: [SAMPLE_TEMPLATE],
    })
    await page.goto('/dashboard')
    const card = page.getByRole('button', { name: /Optimistic pending/i }).first()
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toBeDisabled()
    await expect(page.locator('text=/Saving…/').first()).toBeVisible()
  })
})
