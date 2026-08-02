import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getDesktopSettings,
  initializeDesktopSettings,
  resetDesktopSettingsForTests,
} from './desktop-settings'

describe('desktop settings', () => {
  beforeEach(() => resetDesktopSettingsForTests())

  it('migrates legacy renderer preferences once', async () => {
    localStorage.setItem('ark:appearance', 'dark')
    localStorage.setItem('ark:selected-model', 'openai:gpt-5.6-luna')
    localStorage.setItem(
      'ark:reasoning-effort-by-model:v1',
      JSON.stringify({ 'openai:gpt-5.6-luna': 'high' }),
    )
    window.arkDesktop.settings.get = vi.fn().mockResolvedValue({
      appearance: 'system',
      migratedLegacyRendererPreferences: false,
      reasoningEffortByModel: {},
      selectedModel: null,
    })
    window.arkDesktop.settings.update = vi.fn().mockImplementation(async (patch) => ({
      appearance: 'system',
      migratedLegacyRendererPreferences: false,
      reasoningEffortByModel: {},
      selectedModel: null,
      ...patch,
    }))

    await initializeDesktopSettings()

    expect(getDesktopSettings()).toMatchObject({
      appearance: 'dark',
      migratedLegacyRendererPreferences: true,
      reasoningEffortByModel: { 'openai:gpt-5.6-luna': 'high' },
      selectedModel: 'openai:gpt-5.6-luna',
    })
    expect(localStorage.getItem('ark:appearance')).toBeNull()
    expect(localStorage.getItem('ark:selected-model')).toBeNull()
    expect(localStorage.getItem('ark:reasoning-effort-by-model:v1')).toBeNull()
  })
})
