import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  evaluateGestureInvariants,
  flattenInvariantFailures,
  inspectStoragePath,
  isShellApiReady,
  parseArgs,
  patchPhasesFromLogs,
  resolveProfileStorage,
} from './profile-editor-drag.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profilerPath = path.join(root, 'scripts/profile-editor-drag.mjs')
const electronMainPath = path.join(root, 'apps/desktop/electron/main.ts')

const originalUserDataDir = process.env.ARK_PROFILE_USER_DATA_DIR
const originalWorkspacesDir = process.env.ARK_PROFILE_WORKSPACES_DIR

function restoreProfileEnv() {
  if (originalUserDataDir === undefined) delete process.env.ARK_PROFILE_USER_DATA_DIR
  else process.env.ARK_PROFILE_USER_DATA_DIR = originalUserDataDir
  if (originalWorkspacesDir === undefined) delete process.env.ARK_PROFILE_WORKSPACES_DIR
  else process.env.ARK_PROFILE_WORKSPACES_DIR = originalWorkspacesDir
}

test('parseArgs reads userData/workspaces from CLI and env', () => {
  delete process.env.ARK_PROFILE_USER_DATA_DIR
  delete process.env.ARK_PROFILE_WORKSPACES_DIR
  try {
    const fromFlags = parseArgs([
      '--user-data-dir',
      '/mnt/disk/userData',
      '--workspaces-dir',
      '/mnt/disk/workspaces',
    ])
    assert.equal(fromFlags.userDataDir, '/mnt/disk/userData')
    assert.equal(fromFlags.workspacesDir, '/mnt/disk/workspaces')

    process.env.ARK_PROFILE_USER_DATA_DIR = '/env/userData'
    process.env.ARK_PROFILE_WORKSPACES_DIR = '/env/workspaces'
    const fromEnv = parseArgs([])
    assert.equal(fromEnv.userDataDir, '/env/userData')
    assert.equal(fromEnv.workspacesDir, '/env/workspaces')

    const flagsOverrideEnv = parseArgs(['--user-data-dir', '/cli/userData'])
    assert.equal(flagsOverrideEnv.userDataDir, '/cli/userData')
    assert.equal(flagsOverrideEnv.workspacesDir, '/env/workspaces')
  } finally {
    restoreProfileEnv()
  }
})

test('resolveProfileStorage reports fsType/ephemeral metadata for pinned dirs', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ark-profile-storage-'))
  const userDataDir = path.join(parent, 'userData')
  const workspacesDir = path.join(parent, 'workspaces')
  try {
    const resolved = await resolveProfileStorage({
      userDataDir,
      workspacesDir,
    })
    assert.equal(resolved.ephemeralUserData, false)
    assert.equal(resolved.profileDirectory, path.resolve(userDataDir))
    assert.equal(resolved.workspacesDirectory, path.resolve(workspacesDir))
    assert.equal(resolved.storage.userData.path, path.resolve(userDataDir))
    assert.equal(resolved.storage.workspaces.path, path.resolve(workspacesDir))
    for (const entry of [resolved.storage.userData, resolved.storage.workspaces]) {
      assert.equal(typeof entry.fsType, 'string')
      assert.ok(entry.fsType.length > 0)
      assert.equal(typeof entry.mount, 'string')
      assert.equal(typeof entry.ephemeral, 'boolean')
    }
    const inspected = await inspectStoragePath(userDataDir)
    assert.equal(
      inspected.ephemeral,
      ['tmpfs', 'overlay', 'ramfs', 'aufs'].includes(inspected.fsType),
    )
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('patchPhasesFromLogs keeps deck.patch.completed phase fields', () => {
  const phases = patchPhasesFromLogs([
    { event: 'http.request.completed', durationMs: 12 },
    {
      event: 'deck.patch.completed',
      durationMs: 110.7,
      fields: {
        loadMs: 0.3,
        applyMs: 97.9,
        validateMs: 0,
        persistMs: 10,
        notifyMs: 0.04,
        serializeMs: 0.56,
        htmlBytes: 128238,
        reusedValidation: true,
        documentRevision: 2,
        appliedCount: 1,
      },
    },
  ])
  assert.deepEqual(phases, {
    durationMs: 110.7,
    loadMs: 0.3,
    applyMs: 97.9,
    validateMs: 0,
    persistMs: 10,
    notifyMs: 0.04,
    serializeMs: 0.56,
    htmlBytes: 128238,
    reusedValidation: true,
    documentRevision: 2,
    appliedCount: 1,
  })
})

test('gesture invariants require cancel=0 and commit=1 patches', () => {
  const passing = evaluateGestureInvariants('absolute-500', [
    { run: 1, phase: 'cancel', requestCount: 0, beforeRevision: 1, afterRevision: 1 },
    {
      run: 1,
      phase: 'commit',
      requestCount: 1,
      beforeRevision: 1,
      afterRevision: 2,
      sessionRetained: true,
    },
  ])
  assert.equal(
    passing.every((item) => item.ok),
    true,
  )
  assert.equal(flattenInvariantFailures({ results: [{ invariants: passing }] }).length, 0)

  const failing = evaluateGestureInvariants('absolute-500', [
    { run: 1, phase: 'cancel', requestCount: 1, beforeRevision: 1, afterRevision: 2 },
    { run: 1, phase: 'commit', requestCount: 2, beforeRevision: 2, afterRevision: 3 },
  ])
  const failures = flattenInvariantFailures({ results: [{ invariants: failing }] })
  assert.equal(failures.length, 2)
  assert.match(failures[0].name, /cancellation/)
  assert.match(failures[1].name, /commit/)
})

test('isShellApiReady waits for an HTTP origin plus /api/health', () => {
  assert.equal(isShellApiReady('about:blank', true), false)
  assert.equal(isShellApiReady('', true), false)
  assert.equal(isShellApiReady('http://127.0.0.1:5173/', false), false)
  assert.equal(isShellApiReady('http://127.0.0.1:5173/', true), true)
})

test('launchElectron waits for /api/health before runCase createDeck', async () => {
  const source = await readFile(profilerPath, 'utf8')
  const launchStart = source.indexOf('async function launchElectron')
  const launchEnd = source.indexOf('async function getIframeContext')
  const runCaseStart = source.indexOf('async function runCase')
  const createDeckCall = source.indexOf('await createDeck(', runCaseStart)
  assert.ok(launchStart >= 0)
  assert.ok(launchEnd > launchStart)
  assert.ok(runCaseStart > launchEnd)
  assert.ok(createDeckCall > runCaseStart)

  const launchBody = source.slice(launchStart, launchEnd)
  assert.match(launchBody, /fetch\('\/api\/health'\)/)
  assert.match(launchBody, /isShellApiReady/)
  assert.match(launchBody, /ARK_WORKSPACES_DIR: workspacesDirectory/)
  assert.equal(launchBody.includes('createDeck('), false)
  assert.match(source, /this script itself is measurement-only/)
})

test('Electron main honors ARK_WORKSPACES_DIR before the Documents fallback', async () => {
  const source = await readFile(electronMainPath, 'utf8')
  assert.match(source, /if \(!process\.env\.ARK_WORKSPACES_DIR\?\.trim\(\)\)/)
})
