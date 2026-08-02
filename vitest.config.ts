import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      './packages/*/vitest.config.ts',
      './apps/api/vitest.shared.config.ts',
      './apps/api/vitest.isolated.config.ts',
      './apps/sandbox/vitest.config.ts',
      './apps/desktop/vitest.shared.config.ts',
      './apps/desktop/vitest.isolated.config.ts',
    ],
  },
})
