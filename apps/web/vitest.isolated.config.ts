import { defineConfig } from 'vitest/config'

import viteConfig from './vite.config.ts'
import { isolatedTests } from './vitest.shared.config.ts'

export default defineConfig((configEnv) => {
  const base = viteConfig(configEnv)

  return {
    ...base,
    root: __dirname,
    test: {
      ...base.test,
      name: '@ark/web-isolated',
      include: isolatedTests,
      environmentMatchGlobs: [],
    },
  }
})
