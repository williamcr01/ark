import { create } from 'zustand'

import type { ModelInfo } from '@ark/contracts'

import { resolveUpdate, type StateUpdate } from './apply-update.ts'

export type AvailableModel = ModelInfo
export type ApiKeyStatus = 'checking' | 'missing' | 'invalid' | 'valid'

export type ModelsStoreState = {
  models: AvailableModel[]
  warnings: string[]
  isLoading: boolean
  error: string
  defaultModel: string | null
  apiKeyStatus: ApiKeyStatus
}

export type ModelsCatalogUpdate = {
  models: AvailableModel[]
  defaultModel: string | null
  warnings?: string[]
  apiKeyStatus: ApiKeyStatus
}

export type ModelsStoreActions = {
  applyCatalog: (catalog: ModelsCatalogUpdate) => void
  clearCatalog: (error: string, apiKeyStatus: ApiKeyStatus) => void
  reset: () => void
  setError: (error: string) => void
  setLoading: (update: StateUpdate<boolean>) => void
  setModels: (models: AvailableModel[]) => void
  setWarnings: (warnings: string[]) => void
}

export type ModelsStore = ModelsStoreState & ModelsStoreActions

const initialState: ModelsStoreState = {
  models: [],
  warnings: [],
  isLoading: true,
  error: '',
  defaultModel: null,
  apiKeyStatus: 'checking',
}

export const useModelsStore = create<ModelsStore>()((set) => ({
  ...initialState,
  applyCatalog: (catalog) => {
    set({
      models: catalog.models,
      defaultModel: catalog.defaultModel,
      warnings: catalog.warnings ?? [],
      apiKeyStatus: catalog.apiKeyStatus,
      error: '',
    })
  },
  clearCatalog: (error, apiKeyStatus) => {
    set({
      models: [],
      defaultModel: null,
      warnings: [],
      error,
      apiKeyStatus,
    })
  },
  reset: () => {
    set(initialState)
  },
  setError: (error) => {
    set({ error })
  },
  setLoading: (update) => {
    set((state) => ({ isLoading: resolveUpdate(state.isLoading, update) }))
  },
  setModels: (models) => {
    set({ models })
  },
  setWarnings: (warnings) => {
    set({ warnings })
  },
}))

export const useModels = () => useModelsStore((state) => state.models)
export const useModelsError = () => useModelsStore((state) => state.error)
