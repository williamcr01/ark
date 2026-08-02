import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      './packages/*/vitest.config.ts',
      './apps/api/vitest.shared.config.ts',
      './apps/api/vitest.isolated.config.ts',
      './apps/sandbox/vitest.config.ts',
      './apps/web/vitest.shared.config.ts',
      './apps/web/vitest.isolated.config.ts',
    ],
  },
})
