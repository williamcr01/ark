import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.{test,spec}.ts'],
    // Keep API setup free of React/jsdom testing-library — those cost tens of
    // seconds of setup across ~50 node files for no benefit.
    setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
  },
})
