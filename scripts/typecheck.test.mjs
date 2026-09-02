import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import { DEFAULT_CONCURRENCY, PROJECTS, resolveTscBin } from './typecheck.mjs'

test('typecheck covers every workspace tsconfig used by build', () => {
  assert.deepEqual(PROJECTS, [
    'apps/desktop/tsconfig.app.json',
    'apps/desktop/tsconfig.app.test.json',
    'apps/desktop/tsconfig.node.json',
    'apps/desktop/tsconfig.node.test.json',
    'apps/api/tsconfig.json',
    'apps/api/tsconfig.test.json',
    'apps/mcp/tsconfig.json',
    'apps/mcp/tsconfig.test.json',
    'apps/sandbox/tsconfig.json',
    'apps/sandbox/tsconfig.test.json',
    'packages/ai/tsconfig.json',
    'packages/ai/tsconfig.test.json',
    'packages/agent/tsconfig.json',
    'packages/agent/tsconfig.test.json',
    'packages/chat/tsconfig.json',
    'packages/chat/tsconfig.test.json',
    'packages/contracts/tsconfig.json',
    'packages/contracts/tsconfig.test.json',
    'packages/deck/tsconfig.json',
    'packages/deck/tsconfig.test.json',
    'packages/deck-export/tsconfig.json',
    'packages/deck-export/tsconfig.test.json',
    'packages/deck-import/tsconfig.json',
    'packages/deck-import/tsconfig.test.json',
    'packages/deck-node/tsconfig.json',
    'packages/deck-node/tsconfig.test.json',
    'packages/deck-preview/tsconfig.json',
    'packages/deck-preview/tsconfig.test.json',
    'packages/editor-runtime/tsconfig.json',
    'packages/editor-runtime/tsconfig.test.json',
    'packages/mcp/tsconfig.json',
    'packages/mcp/tsconfig.test.json',
    'packages/runtime-registry/tsconfig.json',
    'packages/runtime-registry/tsconfig.test.json',
    'packages/storage/tsconfig.json',
    'packages/storage/tsconfig.test.json',
    'packages/telemetry/tsconfig.json',
    'packages/telemetry/tsconfig.test.json',
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
