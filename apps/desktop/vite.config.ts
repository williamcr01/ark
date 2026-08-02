import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

const repoRoot = path.resolve(__dirname, '../..')
const DEFAULT_API_PORT = '8787'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '')
  const apiPort = process.env.PORT ?? env.PORT ?? DEFAULT_API_PORT
  const resolveAlias = {
    '@': path.resolve(__dirname, './src'),
    '@fixtures': path.resolve(repoRoot, 'test/fixtures'),
  }

  return {
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    // Streamdown plugins (Shiki language grammars, Mermaid, KaTeX) produce
    // on-demand async chunks above 500 kB. Routes and message rendering are
    // split from the entry; only optional grammars and diagram modules exceed
    // the default Vite threshold.
    build: {
      chunkSizeWarningLimit: 800,
      outDir: 'dist/renderer',
    },
    resolve: {
      alias: resolveAlias,
    },
    server: {
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      // Pure lib unit tests do not need a DOM; skip jsdom boot for those files.
      environmentMatchGlobs: [
        ['src/lib/agent-themes.test.ts', 'node'],
        ['src/lib/asset-api.test.ts', 'node'],
        ['src/lib/chat-reconcile.test.ts', 'node'],
        ['src/lib/deck-api.test.ts', 'node'],
        ['src/lib/deck-editor-patches.test.ts', 'node'],
        ['src/lib/deck-text-edit.test.ts', 'node'],
        ['src/lib/editor-overlay-geometry.test.ts', 'node'],
        ['src/lib/editor-selection-context.test.ts', 'node'],
        ['src/lib/element-inspector.test.ts', 'node'],
        ['src/lib/generation-job-api.test.ts', 'node'],
        ['src/lib/slide-context.test.ts', 'node'],
        ['src/lib/undo-redo-version-options.test.ts', 'node'],
        ['src/lib/version-history-display.test.ts', 'node'],
      ],
      environmentOptions: {
        jsdom: {
          url: 'http://localhost:5173',
        },
      },
    },
  }
})
