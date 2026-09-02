import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LAYERS,
  SERVER_ONLY,
  collectWorkspace,
  findViolations,
} from './check-package-boundaries.mjs'

const EMPTY_ROOT = '/tmp/ark-boundaries-no-tsconfig'

function workspaceFromGraph(graph = {}) {
  const workspace = new Map()
  for (const name of Object.keys(LAYERS)) {
    const used = graph[name] ?? []
    workspace.set(name, {
      dir: `/tmp/${name}`,
      group: 'packages',
      manifest: {
        name,
        dependencies: Object.fromEntries(used.map((dep) => [dep, 'workspace:*'])),
      },
      declared: new Set(used),
      used: new Set(used),
    })
  }
  return workspace
}

test('rejects a browser-safe package that imports a lower-layer server-only package', () => {
  const problems = findViolations(
    workspaceFromGraph({
      '@ark/deck': ['@ark/runtime-registry'],
      '@ark/storage': ['@ark/deck'],
      '@ark/contracts': ['@ark/deck', '@ark/storage'],
    }),
    EMPTY_ROOT,
  )

  assert.equal(
    problems.some((problem) =>
      problem.includes(
        '@ark/contracts is browser-safe but imports server-only @ark/storage — browser-safe packages may not import server-only packages regardless of layer',
      ),
    ),
    true,
  )
  assert.equal(
    problems.some((problem) => problem.includes('strictly lower layer only')),
    false,
  )
})

test('rejects a browser-safe package even when the server-only import is a lower layer than itself', () => {
  const problems = findViolations(
    workspaceFromGraph({
      '@ark/deck': ['@ark/runtime-registry'],
      '@ark/deck-import': ['@ark/deck'],
      '@ark/deck-preview': ['@ark/deck', '@ark/deck-import'],
    }),
    EMPTY_ROOT,
  )

  assert.equal(
    problems.some((problem) =>
      problem.includes(
        '@ark/deck-preview is browser-safe but imports server-only @ark/deck-import — browser-safe packages may not import server-only packages regardless of layer',
      ),
    ),
    true,
  )
})

test('allows a server-only package to import another server-only package on a lower layer', () => {
  const problems = findViolations(
    workspaceFromGraph({
      '@ark/deck': ['@ark/runtime-registry'],
      '@ark/storage': ['@ark/deck'],
      '@ark/contracts': ['@ark/deck'],
      '@ark/agent': ['@ark/contracts', '@ark/storage'],
    }),
    EMPTY_ROOT,
  )

  assert.deepEqual(
    problems.filter((problem) => problem.includes('server-only')),
    [],
  )
})

test('this repo: browser-safe packages do not import server-only packages', () => {
  const workspace = collectWorkspace()
  assert.equal(SERVER_ONLY.has('@ark/storage'), true)
  assert.equal(workspace.get('@ark/contracts').used.has('@ark/storage'), false)
  assert.equal(workspace.get('@ark/contracts').declared.has('@ark/storage'), false)

  for (const [name, entry] of workspace) {
    if (!(name in LAYERS) || SERVER_ONLY.has(name)) continue
    for (const dep of entry.used) {
      assert.equal(
        SERVER_ONLY.has(dep),
        false,
        `${name} is browser-safe but imports server-only ${dep}`,
      )
    }
  }

  assert.deepEqual(findViolations(workspace), [])
})
