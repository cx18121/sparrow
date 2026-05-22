import { chromium, type Browser, type Page } from "playwright";

// Lightweight Playwright wrapper for scrape adapters. Use this when an
// adapter's target site renders portfolio data client-side (Framer, Next.js
// 13 RSC, lazy-loaded Webflow grids, hand-rolled SPAs) — i.e. when curl +
// cheerio can't reach the data.
//
// Cost model: ~1-3s startup per browser launch + ~1s per page load. Don't
// launch a browser per row — launch once, run multiple navigations on the
// same page when scraping a single source.
//
// Usage:
//   import { withBrowser, renderPage } from "./_lib/playwright-scrape.js";
//
//   await withBrowser(async (browser) => {
//     const html = await renderPage(browser, "https://example.com/portfolio", {
//       waitFor: ".company-card",       // wait for this selector to appear
//       waitForTimeout: 15_000,         // selector-wait cap (default 10s)
//       scrollToBottom: true,           // trigger lazy-load
//     });
//     // parse html with cheerio as usual
//   });

export interface RenderOptions {
  // CSS selector to wait for before considering the page "ready". If absent,
  // we wait for `networkidle` instead (no in-flight requests for 500ms).
  waitFor?: string;
  // Timeout for the selector wait, in ms. Default 10s.
  waitForTimeout?: number;
  // Scroll to bottom of page to trigger lazy-load / infinite-scroll content.
  // Repeats scroll + 1s settle until two consecutive measurements of
  // document.body.scrollHeight match.
  scrollToBottom?: boolean;
  // Override user agent. Default is a recent Chrome on macOS.
  userAgent?: string;
  // Navigation timeout in ms. Default 30s.
  navigationTimeout?: number;
}

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function withBrowser<T>(
  fn: (browser: Browser) => Promise<T>
): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function renderPage(
  browser: Browser,
  url: string,
  opts: RenderOptions = {}
): Promise<string> {
  const context = await browser.newContext({
    userAgent: opts.userAgent ?? DEFAULT_UA,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const navTimeout = opts.navigationTimeout ?? 30_000;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeout });

    if (opts.waitFor) {
      try {
        await page.waitForSelector(opts.waitFor, {
          timeout: opts.waitForTimeout ?? 10_000,
        });
      } catch {
        // Selector didn't appear — log but don't throw; let the caller decide
        // whether the partial HTML is still useful.
        console.warn(`[playwright] selector "${opts.waitFor}" not found at ${url}`);
      }
    } else {
      // No selector hint → wait for network idle. Cap at navigation timeout.
      try {
        await page.waitForLoadState("networkidle", { timeout: navTimeout });
      } catch {
        console.warn(`[playwright] networkidle not reached at ${url}`);
      }
    }

    if (opts.scrollToBottom) {
      await scrollToBottomUntilStable(page);
    }

    return await page.content();
  } finally {
    await context.close();
  }
}

// Scroll page in 1000px chunks, waiting 800ms between scrolls. Stops when
// document.body.scrollHeight stabilizes for two consecutive measurements OR
// after 50 scroll-cycles (safety cap — catches infinite-scroll feeds that
// keep streaming).
async function scrollToBottomUntilStable(page: Page): Promise<void> {
  let lastHeight = -1;
  let stableCount = 0;
  for (let i = 0; i < 50; i++) {
    const height = await page.evaluate(() => document.body.scrollHeight);
    if (height === lastHeight) {
      stableCount++;
      if (stableCount >= 2) return;
    } else {
      stableCount = 0;
      lastHeight = height;
    }
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(800);
  }
}
