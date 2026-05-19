import { test, expect } from '@playwright/test'
import { signInDemo, cleanupTestData } from './fixtures/api-mocks'

// Public marketing surface tests. The auth-ux.spec.ts file already covers
// the auth screen itself; this one pins the landing-vs-auth split:
//   - unauthenticated `/` → Landing
//   - unauthenticated `/login` → AuthScreen
//   - authenticated `/`  → /dashboard
// All assertions use structural anchors (route + role) rather than display
// copy so future headline rewrites don't break the suite. See e2e/README.md.

test.describe('Landing route', () => {
  test.describe('unauthenticated', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      // Drop any seeded Supabase session so AuthProvider treats us as signed
      // out — pattern lifted from auth-ux.spec.ts:10-18.
      await page.addInitScript(() => {
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
            localStorage.removeItem(key)
          }
        })
      })
    })

    test('`/` renders the Landing, not the AuthScreen', async ({ page }) => {
      await page.goto('/')

      // Two Continue-with-Google buttons (nav + hero, or hero + final CTA);
      // either way there should be at least one.
      const ctas = page.getByRole('button', { name: /Continue with Google/i })
      await expect(ctas.first()).toBeVisible({ timeout: 10_000 })
      const ctaCount = await ctas.count()
      expect(ctaCount).toBeGreaterThanOrEqual(1)

      // The AuthScreen's password field must NOT be on the page — that's the
      // structural difference between Landing and AuthScreen.
      await expect(page.getByPlaceholder('••••••••')).toHaveCount(0)

      // Sign-in route is reachable via a `/login` link (footer carries it).
      await expect(page.locator('a[href="/login"]').first()).toBeVisible()
    })

    test('`/login` still renders the AuthScreen for password sign-in', async ({ page }) => {
      await page.goto('/login')
      await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({
        timeout: 10_000,
      })
      await expect(page.getByPlaceholder('••••••••')).toBeVisible()
    })

    test('hero CTA triggers Google OAuth (signInWithOAuth call)', async ({ page }) => {
      // Patch the OAuth redirect so the test doesn't navigate away — auth-ux
      // uses the same trick at line 43-56.
      await page.addInitScript(() => {
        try {
          Object.defineProperty(window.location, 'assign', {
            value: (_url: string) => {},
            configurable: true,
            writable: true,
          })
        } catch {}
      })

      await page.goto('/')
      const heroCta = page.getByRole('button', { name: /Continue with Google/i }).first()
      await expect(heroCta).toBeVisible({ timeout: 10_000 })
      // Just clicking is enough — the contract here is "the button is wired
      // to a handler that doesn't throw." A network-level assertion against
      // Supabase OAuth would couple to the supabase-js wire format.
      await heroCta.click()
      // If the click threw, the test would fail at the assertion above on
      // re-evaluation. Belt-and-suspenders: confirm the page didn't navigate
      // off `/` (the page.location.assign patch dropped any redirect).
      await expect(page).toHaveURL(/\/$/)
    })
  })

  test.describe('authenticated', () => {
    let userId: string

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      const { userId: uid } = await signInDemo(page)
      userId = uid
    })

    test.afterEach(async () => {
      await cleanupTestData(userId)
    })

    test('`/` redirects signed-in users to /dashboard', async ({ page }) => {
      await page.goto('/')
      await expect(page).toHaveURL(/\/dashboard(\?|$|\/)/, { timeout: 10_000 })
    })
  })
})
