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
  const resolveAlias = {
    '@': path.resolve(__dirname, './src'),
    '@fixtures': path.resolve(__dirname, './test/fixtures'),
  }

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
      alias: resolveAlias,
    },
    server: {
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
    test: {
      projects: [
        {
          resolve: { alias: resolveAlias },
          plugins: [react(), tailwindcss()],
          test: {
            name: 'server',
            environment: 'node',
            include: ['server/**/*.{test,spec}.ts'],
            setupFiles: ['./src/test/setup.ts'],
          },
        },
        {
          resolve: { alias: resolveAlias },
          test: {
            name: 'shared',
            environment: 'node',
            include: ['shared/**/*.{test,spec}.ts'],
            setupFiles: ['./src/test/setup.ts'],
          },
        },
        {
          resolve: { alias: resolveAlias },
          plugins: [react(), tailwindcss()],
          test: {
            name: 'client',
            environment: 'jsdom',
            include: ['src/**/*.{test,spec}.{ts,tsx}'],
            setupFiles: ['./src/test/setup.ts'],
            environmentOptions: {
              jsdom: {
                url: 'http://localhost:5173',
              },
            },
          },
        },
      ],
    },
  }
})
