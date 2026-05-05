import { test, expect } from '@playwright/test'
import { mockApi } from './fixtures/api-mocks'

async function signInNeedsOnboarding(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const id = 'onboarding-gmail-user'
    const data = {
      senderName: 'Demo User',
      styleChoices: { tone: 'a', length: 'a', ask: 'a', personalization: 'a' },
      customTemplate: {
        name: 'Intro',
        subject: 'Quick question about {{company}}',
        body: 'Hi {{first_name}},\\n\\nWanted to reach out.\\n\\nBest,\\n{{sender_name}}',
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

test('onboarding includes an explicit Gmail connection step before dashboard access', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signInNeedsOnboarding(page)
  const profilePosts: any[] = []
  const calls: string[] = []
  await mockApi(page, {
    profile: {
      hasGoogleRefreshToken: false,
    },
  })
  await page.route('**/api/profile', async route => {
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
  })
  await page.route('**/api/google/connect', route => {
    calls.push('google')
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: '/oauth-started' }),
    })
  })

  await page.goto('/dashboard')

  await expect(page.getByRole('button', { name: /Go to Gmail/i })).toBeVisible()
  await page.getByPlaceholder('Maya Chen').fill('Demo User')
  await page.getByPlaceholder('Relevant experience, club role, recent work...').fill('Built outreach tooling for Cornell GenAI.')
  await page.getByRole('button', { name: /^Next$/i }).click()
  await page.getByRole('button', { name: /^Next$/i }).click()
  await expect(page.getByRole('heading', { name: /Connect Gmail/i })).toBeVisible()
  const card = page.locator('.rounded-2xl').filter({ hasText: /Gmail not connected/ }).first()
  await expect(card.getByRole('button', { name: /^Connect Gmail$/i })).toBeVisible()
  await expect(card.getByRole('button', { name: /^Refresh$/i })).toBeVisible()
  await card.getByRole('button', { name: /^Connect Gmail$/i }).click()
  await expect.poll(() => calls).toEqual(['profile'])
  expect(profilePosts[0]?.workspaceConfig?.resumeText).toBe('Built outreach tooling for Cornell GenAI.')
  expect(profilePosts[0]?.resumeText).toBe('Built outreach tooling for Cornell GenAI.')
  expect(profilePosts[0]?.onboardingCompleted).toBe(false)
})
