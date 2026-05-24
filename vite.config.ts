import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Landing-page proof line ("Search across X startups from Y portfolio
// sources.") is baked into the bundle at production build time by
// reading the live DB. Dev mode skips the query and uses the fallback
// so `vite dev` stays fast and works without DATABASE_URL set.
//
// The fallback matches the last manually-counted value from CLAUDE.md
// (~12.3k companies, 44 ingest sources). Production builds without DB
// access (PR previews, fresh CI) also fall back so the page still
// renders a credible number.
const SPARROW_STATS_FALLBACK = { startups: 12317, sources: 44 }

function fetchSparrowStats(mode: string): { startups: number; sources: number } {
  if (mode !== 'production') return SPARROW_STATS_FALLBACK
  try {
    const raw = execSync('npx tsx scripts/print-stats.ts', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'inherit'],
      timeout: 15000,
    }).trim()
    const parsed = JSON.parse(raw) as { startups: number; sources: number }
    if (typeof parsed.startups !== 'number' || typeof parsed.sources !== 'number') {
      throw new Error('print-stats returned malformed payload')
    }
    console.log(`[stats] Bundled live counts: ${parsed.startups} startups, ${parsed.sources} sources`)
    return parsed
  } catch (err) {
    console.warn(`[stats] DB query failed (${(err as Error).message}); using fallback ${SPARROW_STATS_FALLBACK.startups}/${SPARROW_STATS_FALLBACK.sources}`)
    return SPARROW_STATS_FALLBACK
  }
}

// One chunk per npm package (or per @scope) so bumping a single dep
// invalidates only that chunk for returning users — the rest stay cached.
// React + react-router get explicit buckets because their internal packages
// always ship together (react/react-dom/scheduler, react-router/@remix-run/
// router) and splitting them just adds round-trips.
function packageChunk(id: string) {
  if (!id.includes('node_modules')) return null
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
    return 'vendor-react'
  }
  if (/[\\/]node_modules[\\/](react-router|react-router-dom|@remix-run[\\/]router)[\\/]/.test(id)) {
    return 'vendor-react-router'
  }
  const match = id.match(/[\\/]node_modules[\\/](@[^/\\]+|[^/\\]+)/)
  if (!match) return null
  const pkg = match[1].replace(/[@/]/g, '-').replace(/^-/, '')
  return `vendor-${pkg}`
}

export default defineConfig(({ mode }) => {
  const stats = fetchSparrowStats(mode)
  return {
  plugins: [react()],
  define: {
    __SPARROW_STARTUP_COUNT__: JSON.stringify(stats.startups),
    __SPARROW_SOURCE_COUNT__: JSON.stringify(stats.sources),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdf-parser'
          if (id.includes('mammoth')) return 'docx-parser'
          // TipTap's underlying engine. Without this, ~530KB of ProseMirror
          // source + linkifyjs lands in the initial `vendor` chunk even
          // though only the (lazy) TemplatesTab uses the editor.
          if (
            id.includes('@tiptap')
            || id.includes('/prosemirror-')
            || id.includes('/linkifyjs/')
            || id.includes('/orderedmap/')
            || id.includes('/rope-sequence/')
            || id.includes('/w3c-keyname/')
            || id.includes('/tippy.js/')
            || id.includes('/@popperjs/')
          ) return 'editor'
          if (id.includes('dompurify')) return 'html-sanitize'
          return packageChunk(id)
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  }
})
