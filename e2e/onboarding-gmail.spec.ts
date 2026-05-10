import { test, expect } from '@playwright/test'
import {
  LOCAL_SUPABASE_URL,
  ANON_KEY,
  cleanupTestData,
} from './fixtures/api-mocks'

// The onboarding tests need a user who has NOT completed onboarding.
// We sign in with a real JWT but deliberately do NOT mark onboarding as
// complete in localStorage so the app redirects to the wizard.

async function signInNeedsOnboarding(page: import('@playwright/test').Page) {
  // Intercept localStorage.getItem for onboarding keys to return NOT complete,
  // so the app shows the onboarding wizard after sign-in.
  await page.addInitScript(() => {
    const origGetItem = localStorage.getItem.bind(localStorage)
    localStorage.getItem = (key: string) => {
      if (key.startsWith('cf_onboarding_') && !key.endsWith('_editing')) {
        return JSON.stringify({
          completed: false,
          completedAt: null,
          updatedAt: new Date().toISOString(),
          data: {
            senderName: 'Demo User',
            styleProfile: { examples: ['hi'] },
          },
        })
      }
      return origGetItem(key)
    }
  })

  // Mock Supabase storage so resume uploads succeed without a real bucket.
  await page.route('**/storage/v1/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Key: 'resumes/fake-path/resume.txt', Id: 'fake-id' }),
    }),
  )

  // Sign in via the real form.
  await page.goto('/dashboard')
  await page.getByPlaceholder('you@example.com').fill('e2e@sparrow.test')
  await page.getByPlaceholder('••••••••').fill('SparrowE2E2024!')
  await page.getByRole('button', { name: /^Sign in$/i }).click()

  // Wait for the auth form to disappear (sign-in completed).
  await page.waitForSelector('h2:has-text("Welcome back")', { state: 'detached', timeout: 15_000 })

  // Get userId from the session stored by Supabase JS client.
  const userId = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        try {
          const s = JSON.parse(localStorage.getItem(key) ?? '')
          if (s?.user?.id) return s.user.id
        } catch { /* skip */ }
      }
    }
    return null
  })

  if (!userId) throw new Error('[signInNeedsOnboarding] Could not determine userId after sign-in')

  // Set editing flag in sessionStorage (bypasses the onboarding-already-seen guard).
  await page.evaluate((uid: string) => {
    sessionStorage.setItem(`cf_onboarding_${uid}_editing`, 'explicit')
  }, userId)

  return { userId }
}

async function mockOnboardingApi(
  page: import('@playwright/test').Page,
  handleProfile: (route: import('@playwright/test').Route) => Promise<void> | void,
) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (path === '/api/profile') return handleProfile(route)
    if (path === '/api/templates') return json({ items: [] })
    if (path === '/api/campaigns') return json({ items: [] })
    if (path === '/api/leads') return json({ items: [] })
    if (path === '/api/custom-contacts') return json({ items: [] })
    if (path === '/api/companies') return json({ items: [], nextCursor: null, seenTotal: 0, usingFallback: false })
    if (path === '/api/campaign-options') return json({ industries: [], regions: [], stages: [], batches: [], tags: {}, hiringCount: 0 })
    if (path === '/api/audience-query') return json({ count: 0, sample: [] })
    if (path === '/api/emails') {
      if (url.searchParams.get('combined') === 'true') return json({ drafts: [], sent: [] })
      if (url.searchParams.get('countToday') === 'true') return json({ count: 0 })
      return json({ items: [] })
    }
    // Pass Google OAuth through to the mockApi google route
    if (path.startsWith('/api/google/')) return json({ url: null, error: 'OAuth not available in test mode' })
    return json({})
  })
}

let userId = ''

test.afterEach(async () => {
  if (userId) await cleanupTestData(userId)
  userId = ''
})

test('onboarding includes an explicit Gmail connection step before dashboard access', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { userId: uid } = await signInNeedsOnboarding(page)
  userId = uid

  const profilePosts: any[] = []
  const calls: string[] = []
  await mockOnboardingApi(page, async route => {
    if (route.request().method() === 'POST') {
      calls.push('profile')
      profilePosts.push(route.request().postDataJSON())
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          onboardingCompleted: false,
          workspaceConfig: {
            senderName: 'Demo User',
            styleChoices: { tone: 'a', length: 'a', ask: 'a', personalization: 'a' },
            customTemplate: { name: 'Intro', subject: '', body: '' },
            templateMode: 'custom',
          },
          hasClaudeKey: true,
          hasGoogleRefreshToken: false,
        },
      }),
    })
  })

  await page.goto('/dashboard')

  // Step 1: About you
  await expect(page.getByRole('heading', { name: /About you/i })).toBeVisible({ timeout: 10_000 })
  await page.getByPlaceholder('Maya Chen').fill('Demo User')
  await page.getByPlaceholder('Founder, GTM Lead, SDR').fill('Student builder')
  await page.getByPlaceholder('Cornell Generative AI').fill('Cornell GenAI')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Built outreach tooling for Cornell GenAI.'),
  })
  await expect(page.locator('text=resume.txt').first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /^Next$/i }).click()

  await expect.poll(() => profilePosts.length).toBeGreaterThanOrEqual(1)
  const firstNextPost = profilePosts.at(-1)
  expect(firstNextPost?.workspaceConfig).toMatchObject({
    senderName: 'Demo User',
    senderRole: 'Student builder',
    senderCompany: 'Cornell GenAI',
    resumeFileName: 'resume.txt',
  })
  expect(firstNextPost?.workspaceConfig?.resumeUploadedAt).toEqual(expect.any(String))
  expect(firstNextPost?.resumeText).toBe('Built outreach tooling for Cornell GenAI.')
  expect(firstNextPost?.onboardingCompleted).toBe(false)

  // Step 2: Template
  await expect(page.getByRole('heading', { name: /Your email template/i })).toBeVisible({
    timeout: 5_000,
  }).catch(() =>
    expect(page.locator('text=/template|template style/i').first()).toBeVisible({ timeout: 5_000 }),
  )
  await page.getByPlaceholder(/Hi \{\{first_name\}\}/).fill('Hi {{first_name}},\n\nWanted to reach out.')
  await page.getByRole('button', { name: /^Next$/i }).click()

  // Step 3: Connect Gmail
  await expect(page.getByRole('heading', { name: /Connect Gmail/i })).toBeVisible({
    timeout: 5_000,
  })
  const card = page.locator('.rounded-2xl').filter({ hasText: /Gmail not connected/ }).first()
  await expect(card.getByRole('button', { name: /^Connect Gmail$/i })).toBeVisible()
  await expect(card.getByRole('button', { name: /^Refresh$/i })).toBeVisible()
  await card.getByRole('button', { name: /^Connect Gmail$/i }).click()
  await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2)
  const finalProfilePost = profilePosts.at(-1)
  expect(finalProfilePost?.workspaceConfig?.resumeUploadedAt).toEqual(expect.any(String))
  expect(finalProfilePost?.resumeText).toBe('Built outreach tooling for Cornell GenAI.')
  expect(finalProfilePost?.onboardingCompleted).toBe(false)
})

test('returns to the Gmail step when Gmail OAuth redirects back to onboarding', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { userId: uid } = await signInNeedsOnboarding(page)
  userId = uid

  await mockOnboardingApi(page, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          onboardingCompleted: false,
          workspaceConfig: {
            senderName: 'Demo User',
            resumeText: 'Built outreach tooling for Cornell GenAI.',
            customTemplate: {
              name: 'Intro',
              subject: 'Quick question about {{company}}',
              body: 'Hi {{first_name}},\\n\\nWanted to reach out.\\n\\nBest,\\n{{sender_name}}',
            },
            templateMode: 'custom',
          },
          hasClaudeKey: true,
          hasGoogleRefreshToken: false,
        },
      }),
    }),
  )

  await page.goto('/dashboard?google_error=callback_failed')

  await expect(page.getByRole('heading', { name: /Connect Gmail/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /About you/i })).toBeHidden()
})

test('continuing without Gmail persists onboarding profile fields and marks onboarding complete', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { userId: uid } = await signInNeedsOnboarding(page)
  userId = uid

  const profilePosts: any[] = []
  await mockOnboardingApi(page, async route => {
    if (route.request().method() === 'POST') {
      profilePosts.push(route.request().postDataJSON())
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          onboardingCompleted: false,
          workspaceConfig: {
            senderName: 'Demo User',
            customTemplate: { name: 'Intro', subject: '', body: '' },
            templateMode: 'custom',
          },
          hasClaudeKey: true,
          hasGoogleRefreshToken: false,
        },
      }),
    })
  })

  await page.goto('/dashboard')

  // Step 1: About
  await page.getByPlaceholder('Maya Chen').fill('Taylor Student')
  await page.getByPlaceholder('Founder, GTM Lead, SDR').fill('Student founder')
  await page.getByPlaceholder('Cornell Generative AI').fill('Cornell GenAI')
  await page
    .getByPlaceholder('Relevant experience, club role, recent work...')
    .fill('Built outbound tooling for student teams.')
  await page.getByRole('button', { name: /^Next$/i }).click()

  // Step 2: Template
  await page
    .getByPlaceholder(/Hi \{\{first_name\}\}/)
    .fill('Hi {{first_name}},\n\nWanted to reach out.')
  await page.getByRole('button', { name: /^Next$/i }).click()

  // Step 3: Gmail — "Finish later" removed; use "Continue without Gmail" instead
  await page.getByRole('button', { name: /Continue without Gmail/i }).click()

  // Wait for a POST that marks onboarding complete
  await expect
    .poll(() => profilePosts.some(p => p.onboardingCompleted === true), { timeout: 10_000 })
    .toBe(true)
  // The completion post should carry the profile fields
  const completionPost = profilePosts.find(p => p.onboardingCompleted === true)
  expect(completionPost?.workspaceConfig).toMatchObject({
    senderName: 'Taylor Student',
    senderRole: 'Student founder',
    senderCompany: 'Cornell GenAI',
  })
})
