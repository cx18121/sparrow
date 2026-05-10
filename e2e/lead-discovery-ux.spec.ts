import { test, expect, type Route } from '@playwright/test'
import {
  mockApi,
  signInDemo,
  createTestCampaign,
  createTestTemplate,
  cleanupTestData,
  SAMPLE_COMPANY,
} from './fixtures/api-mocks'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

let userId: string
let campaignId: string

test.describe('Lead discovery UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { userId: uid } = await signInDemo(page)
    userId = uid
    const template = await createTestTemplate(page, { name: 'Lead discovery template' })
    const campaign = await createTestCampaign(page, {
      name: 'Lead discovery campaign',
      status: 'ACTIVE',
      templateId: template.id,
    })
    campaignId = campaign.id
    await mockApi(page, {
      companiesResponse: {
        items: [SAMPLE_COMPANY],
        nextCursor: null,
        seenTotal: 0,
        usingFallback: false,
      },
    })
  })

  test.afterEach(async () => {
    await cleanupTestData(userId)
  })

  test('saves an Apollo preview into the active campaign', async ({ page }) => {
    let savedLeadPayload: any = null
    let campaignLeadPayload: any = null

    await page.route('**/api/apollo-search', route => {
      if (route.request().method() === 'POST') {
        return json(route, {
          companyId: SAMPLE_COMPANY.id,
          usedFallback: false,
          previews: [
            {
              id: 'person_1',
              firstName: 'Avery',
              lastNameObfuscated: 'K***',
              title: 'Founder',
              hasEmail: true,
              companyName: SAMPLE_COMPANY.name,
            },
          ],
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
        return json(
          route,
          {
            id: 'lead_saved_1',
            userId,
            companyId: savedLeadPayload.companyId,
            contactId: null,
            apolloPersonId: savedLeadPayload.apolloPersonId,
            status: 'SAVED',
          },
          201,
        )
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

    await page.goto(`/campaigns/${campaignId}/leads`)
    await page.getByRole('button', { name: /Find contacts/i }).first().click()
    await expect(page.locator('text=/Avery K/i').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=/avery@acme\\.test/i').first()).toBeVisible()
    await page.getByRole('button', { name: /Save lead/i }).click()

    await expect.poll(() => savedLeadPayload?.apolloPersonId).toBe('person_1')
    await expect.poll(() => campaignLeadPayload?.userLeadId).toBe('lead_saved_1')
    expect(campaignLeadPayload.campaignId).toBe(campaignId)
    await expect(
      page.locator('text=/Avery added to Lead discovery campaign/i'),
    ).toBeVisible()
  })

  test('Save button shows Saved + is disabled when the apolloPersonId is already a UserLead', async ({
    page,
  }) => {
    const previouslySavedLead = {
      id: 'lead_already_saved',
      userId,
      companyId: SAMPLE_COMPANY.id,
      contactId: null,
      apolloPersonId: 'person_dup',
      status: 'SAVED' as const,
      notes: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await page.route('**/api/apollo-search', route => {
      if (route.request().method() === 'POST') {
        return json(route, {
          companyId: SAMPLE_COMPANY.id,
          usedFallback: false,
          previews: [
            {
              id: 'person_dup',
              firstName: 'Avery',
              lastNameObfuscated: 'K***',
              title: 'Founder',
              hasEmail: true,
              companyName: SAMPLE_COMPANY.name,
            },
          ],
        })
      }
      return json(route, {})
    })
    let postLeadCalled = false
    await page.route('**/api/leads**', route => {
      if (route.request().method() === 'POST') {
        postLeadCalled = true
        return json(
          route,
          {
            id: 'lead_dup',
            userId,
            companyId: SAMPLE_COMPANY.id,
            contactId: null,
            apolloPersonId: 'person_dup',
            status: 'SAVED',
          },
          201,
        )
      }
      return json(route, { items: [previouslySavedLead] })
    })

    await page.goto(`/campaigns/${campaignId}/leads`)
    await page.getByRole('button', { name: /Find contacts/i }).first().click()
    await expect(page.locator('text=/Avery K/i').first()).toBeVisible({ timeout: 10_000 })

    const savedButton = page.getByRole('button', { name: /^Saved$/i })
    await expect(savedButton).toBeVisible()
    await expect(savedButton).toBeDisabled()
    await savedButton.click({ force: true }).catch(() => {})
    await page.waitForTimeout(200)
    expect(postLeadCalled).toBe(false)
  })

  test('shows no-contact empty state when Apollo returns no previews', async ({ page }) => {
    await page.route('**/api/apollo-search', route =>
      json(route, { companyId: SAMPLE_COMPANY.id, previews: [], usedFallback: false }),
    )

    await page.goto(`/campaigns/${campaignId}/leads`)
    await page.getByRole('button', { name: /Find contacts/i }).first().click()

    await expect(
      page.locator('text=/Apollo had no contacts on file/i'),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('clears active discovery filters from the empty state', async ({ page }) => {
    await page.route('**/api/companies**', route => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('regionType') || url.searchParams.get('isHiring') === 'true') {
        return json(route, { items: [], nextCursor: null, seenTotal: 0, usingFallback: false })
      }
      return json(route, {
        items: [{ ...SAMPLE_COMPANY, id: 'co_after_clear', name: 'Recovered Company' }],
        nextCursor: null,
        seenTotal: 0,
        usingFallback: false,
      })
    })

    await page.goto(`/campaigns/${campaignId}/leads`)
    await page.getByRole('button', { name: /US only/i }).click()
    await expect(page.locator('text=/No companies match/i')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Clear filters/i }).click()
    await expect(page.locator('text=/Recovered Company/i')).toBeVisible()
  })
})
