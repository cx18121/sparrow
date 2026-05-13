import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:5173';
const OUT = resolve('images');
const PROFILE = resolve('.screenshot-profile');
const CAMPAIGN_ID = process.env.SCREENSHOT_CAMPAIGN_ID ?? 'cmotmar27000004jrnp20p376';

type Shot = { role: string; setup: (page: import('playwright').Page) => Promise<void> };

const shots: Shot[] = [
  { role: 'hero',      setup: async (p) => { await p.goto(`${BASE}/dashboard`); } },
  { role: 'drafts',    setup: async (p) => { await p.goto(`${BASE}/campaigns/${CAMPAIGN_ID}/drafts`); } },
  { role: 'campaign',  setup: async (p) => { await p.goto(`${BASE}/campaigns/${CAMPAIGN_ID}/overview`); } },
  { role: 'leads',     setup: async (p) => { await p.goto(`${BASE}/campaigns/${CAMPAIGN_ID}/leads`); } },
  { role: 'templates', setup: async (p) => { await p.goto(`${BASE}/templates`); } },
  { role: 'audience',  setup: async (p) => {
      await p.goto(`${BASE}/dashboard?new=1`);
      await p.waitForTimeout(1200);
      const input = p.locator('input[placeholder*="YC"], input[placeholder*="Spring"]').first();
      await input.fill('Series A AI infra');
      await p.getByRole('button', { name: 'Continue' }).click();
    } },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 2000, height: 1125 },
    deviceScaleFactor: 1,
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto(`${BASE}/dashboard`);

  // If not signed in, AuthScreen renders. Wait until the sidebar with "Home" shows.
  console.log('Waiting for sign-in (sidebar Home button)... sign in via Google in the open window if needed.');
  await page.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 5 * 60_000 });
  console.log('Signed in. Capturing shots...');

  for (const { role, setup } of shots) {
    await setup(page);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1800);
    const path = resolve(OUT, `sparrow-${role}.png`);
    await page.screenshot({ path, type: 'png' });
    console.log(`  ✓ ${role} → ${path}`);
  }

  // Cancel out of wizard if open
  const cancel = page.getByRole('button', { name: 'Cancel' });
  if (await cancel.count()) await cancel.first().click().catch(() => {});

  await ctx.close();
  console.log('\nDone. Images are 2000×1125 (DPR 1).');
}

main().catch((e) => { console.error(e); process.exit(1); });
