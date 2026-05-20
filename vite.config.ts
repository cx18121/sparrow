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

function packageChunk(id: string) {
  if (!id.includes('node_modules')) return null
  if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) {
    return 'react-vendor'
  }
  if (id.includes('/node_modules/react-router') || id.includes('/node_modules/@remix-run/router')) {
    return 'router'
  }
  if (id.includes('/node_modules/@supabase/')) {
    return 'supabase'
  }
  if (id.includes('/node_modules/lucide-react/')) {
    return 'icons'
  }
  if (id.includes('/node_modules/swr/')) {
    return 'data-client'
  }
  return 'vendor'
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
          if (id.includes('@tiptap')) return 'editor'
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
