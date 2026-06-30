import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

const DEFAULT_API_PORT = '8787'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = process.env.PORT ?? env.PORT ?? DEFAULT_API_PORT

  return {
    plugins: [react(), tailwindcss()],
    // Streamdown plugins (Shiki language grammars, Mermaid, KaTeX) produce
    // on-demand async chunks above 500 kB. The lazy message-response entry
    // stays ~2 kB and the main app bundle ~458 kB; only optional grammars
    // and diagram modules exceed the default Vite threshold.
    build: {
      chunkSizeWarningLimit: 800,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
    test: {
      environment: 'jsdom',
      environmentOptions: {
        jsdom: {
          url: 'http://localhost:5173',
        },
      },
      setupFiles: './src/test/setup.ts',
      include: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'shared/**/*.{test,spec}.ts',
        'server/**/*.{test,spec}.ts',
      ],
    },
  }
})
