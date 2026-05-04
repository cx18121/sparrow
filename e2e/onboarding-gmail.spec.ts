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
  await mockApi(page, {
    profile: {
      hasGoogleRefreshToken: false,
    },
  })
  await page.route('**/api/profile', route =>
    route.fulfill({
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
  )

  await page.goto('/dashboard')

  await expect(page.getByRole('button', { name: /Go to Gmail/i })).toBeVisible()
  await page.getByPlaceholder('Maya Chen').fill('Demo User')
  await page.getByRole('button', { name: /^Next$/i }).click()
  await page.getByRole('button', { name: /^Direct I'm a junior/i }).click()
  await page.getByRole('button', { name: /^Concise I'm a Cornell/i }).click()
  await page.getByRole('button', { name: /^Direct ask I've been/i }).click()
  await page.getByRole('button', { name: /^Light touch I came/i }).click()
  await page.getByRole('button', { name: /^Next$/i }).click()
  await page.getByRole('button', { name: /^Next$/i }).click()
  await expect(page.getByRole('heading', { name: /Connect Gmail/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Connect Gmail$/i })).toBeVisible()
})
