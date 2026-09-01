import path from 'node:path'
import { defineConfig } from 'vitest/config'

const repoRoot = path.resolve(__dirname, '../..')

export default defineConfig({
  resolve: {
    alias: {
      '@fixtures': path.resolve(repoRoot, 'test/fixtures'),
    },
  },
  test: {
    name: '@ark/deck-import',
    environment: 'node',
    include: ['**/*.{test,spec}.ts'],
  },
})
