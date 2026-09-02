import path from 'node:path'
import { defineConfig } from 'vitest/config'

const repoRoot = path.resolve(__dirname, '../..')

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@fixtures': path.resolve(repoRoot, 'test/fixtures'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.{test,spec}.ts'],
  },
})
