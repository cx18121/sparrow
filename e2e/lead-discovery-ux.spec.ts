import { test, expect, type Page, type Route } from '@playwright/test'
import { mockApi, SAMPLE_COMPANY, SAMPLE_TEMPLATE } from './fixtures/api-mocks'

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

const CAMPAIGN_ID = 'cmp_leads_ux'
const CAMPAIGN = {
  id: CAMPAIGN_ID,
  userId: 'demo',
  name: 'Lead discovery campaign',
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
  tone: null,
  attachmentIds: [],
  scheduledAt: null,
  template: { id: SAMPLE_TEMPLATE.id, name: SAMPLE_TEMPLATE.name },
  includePreviouslySaved: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

test.describe('Lead discovery UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInDemo(page)
  })

  test('saves an Apollo preview into the active campaign', async ({ page }) => {
    let savedLeadPayload: any = null
    let campaignLeadPayload: any = null
    await mockApi(page, { campaigns: [CAMPAIGN], templates: [SAMPLE_TEMPLATE], companies: [SAMPLE_COMPANY] })
    await page.unroute('**/api/leads**')
    await page.unroute('**/api/campaign-leads**')
    await page.route('**/api/apollo-search', route => {
      if (route.request().method() === 'POST') {
        return json(route, {
          companyId: SAMPLE_COMPANY.id,
          usedFallback: false,
          previews: [{ id: 'person_1', firstName: 'Avery', lastNameObfuscated: 'K***', title: 'Founder', hasEmail: true, companyName: SAMPLE_COMPANY.name }],
        })
      }
      if (route.request().method() === 'PUT') {
        return json(route, { contact: { email: 'avery@acme.test' } })
      }
      return json(route, {})
    })
    await page.route('**/api/leads**', route => {
      if (route.request().method() === 'POST') {
        savedLeadPayload = route.request().postDataJSON()
        return json(route, { id: 'lead_saved_1', userId: 'demo', companyId: savedLeadPayload.companyId, contactId: null, apolloPersonId: savedLeadPayload.apolloPersonId, status: 'SAVED' }, 201)
      }
      return json(route, { items: [] })
    })
    await page.route('**/api/campaign-leads**', route => {
      if (route.request().method() === 'POST') {
        campaignLeadPayload = route.request().postDataJSON()
        return json(route, { id: 'campaign_lead_1', ...campaignLeadPayload }, 201)
      }
      return json(route, { items: [] })
    })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/leads`)
    await page.getByRole('button', { name: /Find contacts/i }).first().click()
    await expect(page.locator('text=/Avery K/i').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=/avery@acme\\.test/i').first()).toBeVisible()
    await page.getByRole('button', { name: /Save lead/i }).click()

    await expect.poll(() => savedLeadPayload?.apolloPersonId).toBe('person_1')
    await expect.poll(() => campaignLeadPayload?.userLeadId).toBe('lead_saved_1')
    expect(campaignLeadPayload.campaignId).toBe(CAMPAIGN_ID)
    await expect(page.locator('text=/Avery added to Lead discovery campaign/i')).toBeVisible()
  })

  test('Save button shows Saved + is disabled when the apolloPersonId is already a UserLead', async ({ page }) => {
    // The lead was previously saved (e.g. in a different session). The Save
    // button should reflect that state on this render and prevent a duplicate
    // POST /api/leads.
    const previouslySavedLead = {
      id: 'lead_already_saved',
      userId: 'demo',
      companyId: SAMPLE_COMPANY.id,
      contactId: null,
      apolloPersonId: 'person_dup',
      status: 'SAVED' as const,
      notes: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await mockApi(page, {
      campaigns: [CAMPAIGN],
      templates: [SAMPLE_TEMPLATE],
      companies: [SAMPLE_COMPANY],
      leads: [previouslySavedLead],
    })
    await page.route('**/api/apollo-search', route => {
      if (route.request().method() === 'POST') {
        return json(route, {
          companyId: SAMPLE_COMPANY.id,
          usedFallback: false,
          previews: [
            { id: 'person_dup', firstName: 'Avery', lastNameObfuscated: 'K***', title: 'Founder', hasEmail: true, companyName: SAMPLE_COMPANY.name },
          ],
        })
      }
      return json(route, {})
    })
    let postLeadCalled = false
    await page.unroute('**/api/leads**')
    await page.route('**/api/leads**', route => {
      if (route.request().method() === 'POST') {
        postLeadCalled = true
        return json(route, { id: 'lead_dup', userId: 'demo', companyId: SAMPLE_COMPANY.id, contactId: null, apolloPersonId: 'person_dup', status: 'SAVED' }, 201)
      }
      return json(route, { items: [previouslySavedLead] })
    })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/leads`)
    await page.getByRole('button', { name: /Find contacts/i }).first().click()
    await expect(page.locator('text=/Avery K/i').first()).toBeVisible({ timeout: 10_000 })

    // Saved button rendered, disabled, and clicking is a no-op.
    const savedButton = page.getByRole('button', { name: /^Saved$/i })
    await expect(savedButton).toBeVisible()
    await expect(savedButton).toBeDisabled()
    await savedButton.click({ force: true }).catch(() => {})
    await page.waitForTimeout(200)
    expect(postLeadCalled).toBe(false)
  })

  test('shows no-contact empty state when Apollo returns no previews', async ({ page }) => {
    await mockApi(page, { campaigns: [CAMPAIGN], templates: [SAMPLE_TEMPLATE], companies: [SAMPLE_COMPANY] })
    await page.route('**/api/apollo-search', route => json(route, { companyId: SAMPLE_COMPANY.id, previews: [], usedFallback: false }))

    await page.goto(`/campaigns/${CAMPAIGN_ID}/leads`)
    await page.getByRole('button', { name: /Find contacts/i }).first().click()

    await expect(page.locator('text=/Apollo had no contacts on file/i')).toBeVisible({ timeout: 10_000 })
  })

  test('clears active discovery filters from the empty state', async ({ page }) => {
    await mockApi(page, { campaigns: [CAMPAIGN], templates: [SAMPLE_TEMPLATE], companies: [] })
    await page.unroute('**/api/companies**')
    await page.route('**/api/companies**', route => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('regionType') || url.searchParams.get('isHiring') === 'true') {
        return json(route, { items: [], nextCursor: null, seenTotal: 0, usingFallback: false })
      }
      return json(route, { items: [{ ...SAMPLE_COMPANY, id: 'co_after_clear', name: 'Recovered Company' }], nextCursor: null, seenTotal: 0, usingFallback: false })
    })

    await page.goto(`/campaigns/${CAMPAIGN_ID}/leads`)
    await page.getByRole('button', { name: /US only/i }).click()
    await expect(page.locator('text=/No companies match/i')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Clear filters/i }).click()
    await expect(page.locator('text=/Recovered Company/i')).toBeVisible()
  })
})
