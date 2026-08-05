import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DesktopSettingsStore } from './settings-store.ts'

describe('DesktopSettingsStore', () => {
  let directory: string
  let filePath: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ark-settings-'))
    filePath = path.join(directory, 'settings.json')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('persists validated preferences and restores them', async () => {
    const longWorkspaceDirectory = `/workspace/${'nested/'.repeat(200)}`
    const store = new DesktopSettingsStore(filePath)
    await store.update({
      appearance: 'dark',
      selectedModel: 'openai:gpt-5.6-luna',
      reasoningEffortByModel: { 'openai:gpt-5.6-luna': 'high' },
      defaultWorkspaceDirectory: longWorkspaceDirectory,
    })

    const restored = new DesktopSettingsStore(filePath)
    await restored.load()

    expect(restored.get()).toMatchObject({
      appearance: 'dark',
      selectedModel: 'openai:gpt-5.6-luna',
      reasoningEffortByModel: { 'openai:gpt-5.6-luna': 'high' },
      defaultWorkspaceDirectory: longWorkspaceDirectory,
    })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('rejects invalid updates without changing the file', async () => {
    const store = new DesktopSettingsStore(filePath)
    await store.update({ appearance: 'light' })
    const before = await readFile(filePath, 'utf8')

    await expect(store.update({ appearance: 'javascript' })).rejects.toThrow(
      'Invalid appearance preference.',
    )
    expect(await readFile(filePath, 'utf8')).toBe(before)
  })

  it('leaves a corrupt settings file untouched', async () => {
    await writeFile(filePath, 'not-json')
    const store = new DesktopSettingsStore(filePath)

    await store.load()

    expect(store.get().appearance).toBe('system')
    expect(await readFile(filePath, 'utf8')).toBe('not-json')
  })
})
