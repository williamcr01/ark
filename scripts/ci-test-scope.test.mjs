import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyPaths } from './ci-test-scope.mjs'

function decisions(paths, options) {
  const { full, build, test: runTests, smoke } = classifyPaths(paths, options)
  return { full, build, test: runTests, smoke }
}

test('skips executable CI work for documentation and agent guides', () => {
  assert.deepEqual(decisions(['README.md', 'docs/runtimes.md', 'agent-guides/10-reveal-js.md']), {
    full: false,
    build: false,
    test: false,
    smoke: false,
  })
})

test('skips executable CI work for benchmark-only changes', () => {
  assert.deepEqual(
    decisions([
      'benchmarks/TUNING.md',
      'scripts/benchmark-renderer.ts',
      'scripts/lib/renderer-benchmark.test.ts',
    ]),
    {
      full: false,
      build: false,
      test: false,
      smoke: false,
    },
  )
})

test('runs affected tests and smoke for runtime workspace code', () => {
  for (const filePath of [
    'apps/api/app.ts',
    'apps/sandbox/sandbox-index.ts',
    'apps/web/src/App.tsx',
    'packages/contracts/index.ts',
    'packages/deck-core/deck-bridge.ts',
    'packages/runtime-registry/deck-runtime-registry.ts',
  ]) {
    assert.deepEqual(decisions([filePath]), {
      full: false,
      build: true,
      test: true,
      smoke: true,
    })
  }
})

test('does not run browser smoke for workspace-test-only changes', () => {
  assert.deepEqual(
    decisions([
      'apps/api/models.test.ts',
      'apps/web/src/lib/deck-preview.spec.ts',
      'packages/deck-core/test/bridge-helper.ts',
      'docs/testing.md',
    ]),
    {
      full: false,
      build: true,
      test: true,
      smoke: false,
    },
  )
})

test('unions test-only and runtime changes conservatively', () => {
  assert.deepEqual(decisions(['apps/api/models.test.ts', 'apps/web/src/App.tsx', 'README.md']), {
    full: false,
    build: true,
    test: true,
    smoke: true,
  })
})

test('forces full validation for shared and high-risk inputs', () => {
  for (const filePath of [
    '.github/workflows/ci.yml',
    'test/fixtures/hostile-navigation.html',
    'runtimes/manifest.json',
    'openapi/ark.openapi.json',
    'scripts/smoke-plain-css.ts',
    'package.json',
    'pnpm-lock.yaml',
    'apps/api/package.json',
    'apps/web/vite.config.ts',
    'packages/contracts/tsconfig.json',
    'apps/web/src/test/setup.ts',
    'eslint.config.js',
  ]) {
    assert.deepEqual(decisions([filePath]), {
      full: true,
      build: true,
      test: true,
      smoke: true,
    })
  }
})

test('uses full validation for an unclassified path', () => {
  assert.deepEqual(decisions(['presentations/example.html']), {
    full: true,
    build: true,
    test: true,
    smoke: true,
  })
})

test('uses full validation when changed-path detection returns nothing', () => {
  assert.deepEqual(decisions([]), {
    full: true,
    build: true,
    test: true,
    smoke: true,
  })
})

test('allows event and label handling to force full validation', () => {
  assert.deepEqual(decisions(['docs/ci.md'], { forceFullReason: 'Merge candidate' }), {
    full: true,
    build: true,
    test: true,
    smoke: true,
  })
})
