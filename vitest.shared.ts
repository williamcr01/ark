import path from 'node:path'
import { defineConfig } from 'vitest/config'

type PackageVitestOptions = {
  name?: string
  setupFiles?: string[]
  environment?: 'node' | 'jsdom' | 'happy-dom' | 'edge-runtime'
  include?: string[]
}

/** Shared Vitest project config for `packages/*`. Not a Vitest project file itself. */
export function packageVitestConfig(dirname: string, options: PackageVitestOptions = {}) {
  const repoRoot = path.resolve(dirname, '../..')
  return defineConfig({
    root: dirname,
    resolve: {
      alias: {
        '@fixtures': path.resolve(repoRoot, 'test/fixtures'),
      },
    },
    test: {
      name: options.name ?? `@ark/${path.basename(dirname)}`,
      environment: options.environment ?? 'node',
      include: options.include ?? ['**/*.{test,spec}.ts'],
      ...(options.setupFiles ? { setupFiles: options.setupFiles } : {}),
    },
  })
}
