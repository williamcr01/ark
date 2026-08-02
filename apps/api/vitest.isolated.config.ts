import path from 'node:path'
import { defineConfig } from 'vitest/config'

import { isolatedTests } from './vitest.shared.config.ts'

export default defineConfig({
  root: __dirname,
  test: {
    name: '@ark/api-isolated',
    environment: 'node',
    include: isolatedTests,
    setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
  },
})
