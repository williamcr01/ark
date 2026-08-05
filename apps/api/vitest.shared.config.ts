import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

// Module mocks and process-wide background work need a fresh worker.
export const isolatedTests = ['app-observability.test.ts']

export default defineConfig({
  root: __dirname,
  test: {
    name: '@ark/api-shared',
    environment: 'node',
    include: ['**/*.{test,spec}.ts'],
    exclude: [...configDefaults.exclude, ...isolatedTests],
    setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
    isolate: false,
    pool: 'threads',
  },
})
