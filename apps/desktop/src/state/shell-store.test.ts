import { describe, expect, it, vi } from 'vitest'

import { resetDesktopSettingsForTests } from '@/lib/ui/desktop-settings'

import { useShellStore } from './shell-store.ts'

describe('useShellStore', () => {
  it('defaults chat closed and hydrates preferences from desktop settings', () => {
    resetDesktopSettingsForTests({
      appearance: 'dark',
      agentInteractionsInModal: true,
      reasoningEffortByModel: { 'openai:gpt-5.6-luna': 'high' },
    })
    useShellStore.getState().reset()
    useShellStore.getState().syncFromDesktopSettings()

    const state = useShellStore.getState()
    expect(state.isChatOpen).toBe(false)
    expect(state.isDesktop).toBe(false)
    expect(state.appearancePreference).toBe('dark')
    expect(state.agentInteractionsInModal).toBe(true)
    expect(state.reasoningEffortByModel).toEqual({ 'openai:gpt-5.6-luna': 'high' })
    expect(state.selectedModel).toBe('')
  })

  it('setAppearancePreference writes the existing desktop-settings key', () => {
    resetDesktopSettingsForTests({ appearance: 'system' })
    useShellStore.getState().reset()
    useShellStore.getState().setAppearancePreference('light')

    expect(useShellStore.getState().appearancePreference).toBe('light')
    expect(window.arkDesktop.settings.update).toHaveBeenCalledWith({ appearance: 'light' })
  })

  it('setSelectedModel persists empty as null', () => {
    resetDesktopSettingsForTests()
    useShellStore.getState().reset()
    useShellStore.getState().setSelectedModel('openai:gpt-5.6-luna')
    expect(window.arkDesktop.settings.update).toHaveBeenCalledWith({
      selectedModel: 'openai:gpt-5.6-luna',
    })

    vi.mocked(window.arkDesktop.settings.update).mockClear()
    useShellStore.getState().setSelectedModel('')
    expect(window.arkDesktop.settings.update).toHaveBeenCalledWith({ selectedModel: null })
  })

  it('setChatOpen does not persist; layout code owns the storage key', () => {
    useShellStore.getState().reset()
    useShellStore.getState().setChatOpen(true)
    expect(useShellStore.getState().isChatOpen).toBe(true)
    expect(window.localStorage.getItem('ark:chat-open')).toBeNull()
  })
})
