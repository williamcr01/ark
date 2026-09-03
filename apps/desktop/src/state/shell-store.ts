import { create } from 'zustand'

import type { ReasoningEffort } from '@ark/contracts'
import {
  getDesktopSettings,
  updateDesktopSettings,
  type AppearancePreference,
} from '@/lib/ui/desktop-settings'

import { resolveUpdate, type StateUpdate } from './apply-update.ts'

export type ExportingDeck = false | 'pdf' | 'pptx'

export type ShellStoreState = {
  isChatOpen: boolean
  isDesktop: boolean
  agentInteractionsInModal: boolean
  appearancePreference: AppearancePreference
  reasoningEffortByModel: Record<string, ReasoningEffort>
  selectedModel: string
  exportingDeck: ExportingDeck
}

export type ShellStoreActions = {
  reset: () => void
  setAgentInteractionsInModal: (update: StateUpdate<boolean>) => void
  setAppearancePreference: (preference: AppearancePreference) => void
  setChatOpen: (update: StateUpdate<boolean>) => void
  setDesktop: (isDesktop: boolean) => void
  setExportingDeck: (exportingDeck: ExportingDeck) => void
  setReasoningEffortByModel: (effortByModel: Record<string, ReasoningEffort>) => void
  setSelectedModel: (modelId: string) => void
  syncFromDesktopSettings: () => void
}

export type ShellStore = ShellStoreState & ShellStoreActions

const readPreferenceState = (): Pick<
  ShellStoreState,
  'agentInteractionsInModal' | 'appearancePreference' | 'reasoningEffortByModel'
> => {
  const settings = getDesktopSettings()
  return {
    agentInteractionsInModal: settings.agentInteractionsInModal === true,
    appearancePreference: settings.appearance,
    reasoningEffortByModel: settings.reasoningEffortByModel,
  }
}

const initialState = (): ShellStoreState => ({
  isChatOpen: false,
  isDesktop: false,
  selectedModel: '',
  exportingDeck: false,
  ...readPreferenceState(),
})

export const useShellStore = create<ShellStore>()((set) => ({
  ...initialState(),
  reset: () => {
    set(initialState())
  },
  setAgentInteractionsInModal: (update) => {
    set((state) => ({
      agentInteractionsInModal: resolveUpdate(state.agentInteractionsInModal, update),
    }))
  },
  setAppearancePreference: (appearancePreference) => {
    set({ appearancePreference })
    void updateDesktopSettings({ appearance: appearancePreference })
  },
  setChatOpen: (update) => {
    set((state) => ({ isChatOpen: resolveUpdate(state.isChatOpen, update) }))
  },
  setDesktop: (isDesktop) => {
    set({ isDesktop })
  },
  setExportingDeck: (exportingDeck) => {
    set({ exportingDeck })
  },
  setReasoningEffortByModel: (reasoningEffortByModel) => {
    set({ reasoningEffortByModel })
    void updateDesktopSettings({ reasoningEffortByModel })
  },
  setSelectedModel: (selectedModel) => {
    set({ selectedModel })
    void updateDesktopSettings({ selectedModel: selectedModel || null })
  },
  syncFromDesktopSettings: () => {
    set(readPreferenceState())
  },
}))

export const useAppearancePreference = () => useShellStore((state) => state.appearancePreference)
export const useSelectedModel = () => useShellStore((state) => state.selectedModel)
