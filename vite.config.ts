import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  plugins: [react()],
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
})
