import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorage = vi.hoisted(() => ({
  decryptStringAsync: vi.fn(async (value: Buffer) => ({
    result: value.toString('utf8').replace(/^encrypted:/, ''),
    shouldReEncrypt: false,
  })),
  encryptStringAsync: vi.fn(async (value: string) => Buffer.from(`encrypted:${value}`)),
  isAsyncEncryptionAvailable: vi.fn(async () => true),
}))

vi.mock('electron', () => ({ safeStorage }))

import { SecureCredentialStore } from './credential-store.ts'

describe('SecureCredentialStore', () => {
  let directory: string
  let filePath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(true)
    directory = await mkdtemp(path.join(os.tmpdir(), 'ark-credentials-'))
    filePath = path.join(directory, 'auth.json')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('persists encrypted keys and can remove them', async () => {
    const store = new SecureCredentialStore(filePath)
    await store.set('openai', 'sk-secret')

    const storedFile = await readFile(filePath, 'utf8')
    expect(storedFile).not.toContain('sk-secret')
    expect(storedFile).toContain(Buffer.from('encrypted:sk-secret').toString('base64'))

    const restored = new SecureCredentialStore(filePath)
    await restored.load()
    expect(restored.getApiKey('openai')).toBe('sk-secret')
    expect(restored.getStatus().openai.storage).toBe('persistent')
    expect(restored.getStatus().openrouter).toEqual({ configured: false, storage: null })

    await restored.remove('openai')
    expect(restored.getStatus().openai.configured).toBe(false)
  })

  it('rolls back in-memory changes when secure storage is unavailable', async () => {
    safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false)
    const store = new SecureCredentialStore(filePath)

    await expect(store.set('anthropic', 'test-key')).rejects.toThrow(
      process.platform === 'linux'
        ? 'A Secret Service keyring'
        : 'Operating-system secure storage is unavailable.',
    )
    expect(store.getStatus().anthropic.configured).toBe(false)
  })

  it('keeps session-only keys in memory when secure storage is unavailable', async () => {
    safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false)
    const store = new SecureCredentialStore(filePath)

    store.setSession('google', 'test-key')

    expect(store.getApiKey('google')).toBe('test-key')
    expect(store.getStatus().google).toEqual({ configured: true, storage: 'session' })
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never persists session-only keys during another provider save', async () => {
    const store = new SecureCredentialStore(filePath)
    store.setSession('google', 'session-secret')

    await store.set('openai', 'persistent-secret')

    const storedFile = await readFile(filePath, 'utf8')
    expect(storedFile).not.toContain('session-secret')
    expect(storedFile).not.toContain(Buffer.from('encrypted:session-secret').toString('base64'))
    expect(store.getStatus().google.storage).toBe('session')

    const restored = new SecureCredentialStore(filePath)
    await restored.load()
    expect(restored.getApiKey('openai')).toBe('persistent-secret')
    expect(restored.getApiKey('google')).toBeNull()
  })

  it('persists and lists openrouter keys', async () => {
    const store = new SecureCredentialStore(filePath)
    await store.set('openrouter', 'or-secret')

    const restored = new SecureCredentialStore(filePath)
    await restored.load()
    expect(restored.getApiKey('openrouter')).toBe('or-secret')
    expect(restored.getStatus().openrouter).toEqual({ configured: true, storage: 'persistent' })
  })

  it('leaves a corrupt credential file untouched', async () => {
    await writeFile(filePath, 'not-json')
    const store = new SecureCredentialStore(filePath)

    await expect(store.load()).resolves.toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('not-json')
  })
})
