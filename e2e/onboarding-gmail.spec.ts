import { test, expect } from '@playwright/test'

async function signInNeedsOnboarding(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const id = 'onboarding-gmail-user'
    const data = {
      senderName: 'Demo User',
      styleChoices: { tone: 'a', length: 'a', ask: 'a', personalization: 'a' },
      customTemplate: {
        name: 'Intro',
        subject: '',
        body: '',
      },
      templateMode: 'custom',
    }
    localStorage.setItem('cf_demo_id', id)
    localStorage.setItem('cf_demo_user', JSON.stringify({
      id, email: 'demo@test.local',
      user_metadata: { full_name: 'Demo User', avatar_url: null },
    }))
    localStorage.setItem(`cf_onboarding_${id}`, JSON.stringify({
      completed: false,
      completedAt: null,
      updatedAt: new Date().toISOString(),
      data,
    }))
    sessionStorage.setItem(`cf_onboarding_${id}_editing`, 'explicit')
  })
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
    return json({})
  })
}

test('onboarding includes an explicit Gmail connection step before dashboard access', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signInNeedsOnboarding(page)
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
            customTemplate: {
              name: 'Intro',
              subject: '',
              body: '',
            },
            templateMode: 'custom',
          },
          hasClaudeKey: true,
          hasGoogleRefreshToken: false,
        },
      }),
    })
  })

  await page.goto('/dashboard')

  await expect(page.getByRole('button', { name: /Go to Gmail/i })).toBeVisible()
  await page.getByPlaceholder('Maya Chen').fill('Demo User')
  await page.getByPlaceholder('Founder, GTM Lead, SDR').fill('Student builder')
  await page.getByPlaceholder('Cornell Generative AI').fill('Cornell GenAI')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Built outreach tooling for Cornell GenAI.'),
  })
  await page.getByRole('button', { name: /^Next$/i }).click()
  await expect.poll(() => profilePosts.length).toBe(1)
  expect(profilePosts[0]?.workspaceConfig).toMatchObject({
    senderName: 'Demo User',
    senderRole: 'Student builder',
    senderCompany: 'Cornell GenAI',
    resumeText: 'Built outreach tooling for Cornell GenAI.',
    resumeFileName: 'resume.txt',
    resumePath: '',
  })
  expect(profilePosts[0]?.workspaceConfig?.resumeUploadedAt).toEqual(expect.any(String))
  expect(profilePosts[0]?.resumeText).toBe('Built outreach tooling for Cornell GenAI.')
  expect(profilePosts[0]?.onboardingCompleted).toBe(false)
  await page.getByRole('button', { name: /^Next$/i }).click()
  await expect(page.getByRole('heading', { name: /Connect Gmail/i })).toBeVisible()
  const card = page.locator('.rounded-2xl').filter({ hasText: /Gmail not connected/ }).first()
  await expect(card.getByRole('button', { name: /^Connect Gmail$/i })).toBeVisible()
  await expect(card.getByRole('button', { name: /^Refresh$/i })).toBeVisible()
  await card.getByRole('button', { name: /^Connect Gmail$/i }).click()
  await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2)
  const finalProfilePost = profilePosts.at(-1)
  expect(finalProfilePost?.workspaceConfig?.resumeText).toBe('Built outreach tooling for Cornell GenAI.')
  expect(finalProfilePost?.workspaceConfig?.resumeUploadedAt).toEqual(expect.any(String))
  expect(finalProfilePost?.resumeText).toBe('Built outreach tooling for Cornell GenAI.')
  expect(finalProfilePost?.onboardingCompleted).toBe(false)
})

test('returns to the Gmail step when Gmail OAuth redirects back to onboarding', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signInNeedsOnboarding(page)
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
    })
  )

  await page.goto('/dashboard?google_error=callback_failed')

  await expect(page.getByRole('heading', { name: /Connect Gmail/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /About you/i })).toBeHidden()
})

test('continuing without Gmail persists onboarding profile fields and marks onboarding complete', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signInNeedsOnboarding(page)
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
  await page.getByPlaceholder('Relevant experience, club role, recent work...').fill('Built outbound tooling for student teams.')
  await page.getByRole('button', { name: /^Next$/i }).click()

  // Step 2: Template — body is now required before advancing
  await page.getByPlaceholder(/Hi \{\{first_name\}\}/).fill('Hi {{first_name}},\n\nWanted to reach out.')
  await page.getByRole('button', { name: /^Next$/i }).click()

  // Step 3: Gmail — "Finish later" removed; use "Continue without Gmail" instead
  await page.getByRole('button', { name: /Continue without Gmail/i }).click()

  await expect.poll(() => profilePosts.length).toBeGreaterThanOrEqual(1)
  const lastPost = profilePosts[profilePosts.length - 1]
  expect(lastPost?.workspaceConfig).toMatchObject({
    senderName: 'Taylor Student',
    senderRole: 'Student founder',
    senderCompany: 'Cornell GenAI',
  })
  // finish(false) → onComplete → onboardingCompleted: true (not false like the old skipped path)
  expect(lastPost?.onboardingCompleted).toBe(true)
})
