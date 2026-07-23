import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { changedPathsSince, classifyPaths } from './ci-test-scope.mjs'

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

test('diff extraction includes deletions and both sides of renames', () => {
  const repository = mkdtempSync(join(tmpdir(), 'ark-ci-scope-'))

  try {
    mkdirSync(join(repository, 'apps/web/src'), { recursive: true })
    writeFileSync(join(repository, 'apps/web/src/App.tsx'), 'export const app = true\n')
    writeFileSync(join(repository, 'apps/web/src/deleted.ts'), 'export const removed = true\n')
    execFileSync('git', ['init', '--quiet'], { cwd: repository })
    execFileSync('git', ['config', 'user.name', 'CI Scope Test'], { cwd: repository })
    execFileSync('git', ['config', 'user.email', 'ci-scope@example.invalid'], {
      cwd: repository,
    })
    execFileSync('git', ['add', '.'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: repository })
    const base = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    mkdirSync(join(repository, 'docs'))
    renameSync(join(repository, 'apps/web/src/App.tsx'), join(repository, 'docs/App.md'))
    rmSync(join(repository, 'apps/web/src/deleted.ts'))
    execFileSync('git', ['add', '--all'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'rename and delete'], { cwd: repository })

    assert.deepEqual(changedPathsSince(base, repository).sort(), [
      'apps/web/src/App.tsx',
      'apps/web/src/deleted.ts',
      'docs/App.md',
    ])
    assert.equal(classifyPaths(changedPathsSince(base, repository)).smoke, true)
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
})
