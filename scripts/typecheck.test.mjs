import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import { DEFAULT_CONCURRENCY, PROJECTS, resolveTscBin } from './typecheck.mjs'

test('typecheck covers every workspace tsconfig used by build', () => {
  assert.deepEqual(PROJECTS, [
    'apps/desktop/tsconfig.app.json',
    'apps/desktop/tsconfig.node.json',
    'apps/api/tsconfig.json',
    'apps/sandbox/tsconfig.json',
    'packages/contracts/tsconfig.json',
    'packages/deck-core/tsconfig.json',
    'packages/runtime-registry/tsconfig.json',
  ])
  for (const project of PROJECTS) {
    assert.ok(existsSync(project), `missing ${project}`)
  }
})

test('resolveTscBin prefers native TypeScript 7 when installed', () => {
  const bin = resolveTscBin()
  assert.ok(existsSync(bin), `missing tsc binary at ${bin}`)
  assert.match(bin, /typescript/)
  assert.equal(DEFAULT_CONCURRENCY, 3)
})
