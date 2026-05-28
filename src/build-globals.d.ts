// Compile-time constants injected by `vite.config.ts` via the `define`
// option. At production build the values come from `scripts/print-stats.ts`
// (live Prisma query); at dev they fall back to the values in vite.config.
// Used by the landing page's hero proof line.
declare const __SPARROW_STARTUP_COUNT__: number
declare const __SPARROW_SOURCE_COUNT__: number

// Defined in public/ga.js — GA4 dataLayer queue + gtag command queuer.
interface Window {
  gtag?: (...args: unknown[]) => void
  dataLayer?: unknown[]
}
