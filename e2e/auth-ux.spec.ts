import { test, expect } from '@playwright/test'

// Auth UX tests verify the authentication screen behaviour.
// These tests intentionally do NOT sign in — they test the auth UI itself.

test.describe('Auth UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    // Clear any seeded session so the auth screen is shown.
    await page.addInitScript(() => {
      // Remove all Supabase auth tokens (covers both local and production key formats).
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
          localStorage.removeItem(key)
        }
      })
    })
  })

  test('switches between sign-in and sign-up modes without losing form affordances', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
    await expect(page.getByPlaceholder('••••••••')).toBeVisible()

    await page.getByRole('button', { name: /^Sign up$/i }).click()
    await expect(page.getByRole('heading', { name: /Create account/i })).toBeVisible()
    await expect(page.getByPlaceholder('Jane Smith')).toBeVisible()

    await page.getByRole('button', { name: /^Sign in$/i }).click()
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible()
    await expect(page.getByPlaceholder('Jane Smith')).toHaveCount(0)
  })

  test('surfaces a clear Google OAuth error', async ({ page }) => {
    // Patch supabase.auth.signInWithOAuth on the live module singleton so it
    // returns an error instead of triggering a redirect.
    await page.addInitScript(() => {
      const origAssign = window.location.assign.bind(window.location)
      try {
        Object.defineProperty(window.location, 'assign', {
          value: (_url: string) => {
            // Drop the navigation.
          },
          configurable: true,
          writable: true,
        })
      } catch {
        ;(window as any).__locationAssignPatched = true
      }
    })

    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({
      timeout: 10_000,
    })

    await page.evaluate(async () => {
      try {
        const mod =
          (window as any).__vite_module_cache__?.['src/lib/supabase.ts'] ??
          (await import('/src/lib/supabase.ts'))
        if (mod?.supabase?.auth) {
          mod.supabase.auth.signInWithOAuth = async () => ({
            data: { provider: 'google', url: '' },
            error: {
              message: 'oauth_error: popup could not open',
              code: 'oauth_error',
              status: 400,
            },
          })
        }
      } catch {
        // Fallback: if dynamic import doesn't work, rely on route interception.
      }
    })

    await page.getByRole('button', { name: /Continue with Google/i }).click()

    await expect(page.locator('text=/Google sign-in could not open/i')).toBeVisible({
      timeout: 5_000,
    })
  })
})
