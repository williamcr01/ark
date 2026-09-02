import { useCallback, useEffect } from 'react'

import { getDesktopSettings } from '@/lib/ui/desktop-settings'
import { useModelsStore } from '@/state/models-store.ts'
import { useShellStore } from '@/state/shell-store.ts'

import {
  fetchModelCatalog,
  fetchModelCatalogWithRetry,
  isTransientModelLoadError,
  resolveSelectedModel,
  toApiKeyStatus,
  type AvailableModel,
} from './model-catalog.ts'

export type { ApiErrorCode, ApiKeyStatus, AvailableModel, ProviderId } from './model-catalog.ts'
export {
  EMPTY_MODEL_CATALOG_COPY,
  fetchModelCatalogWithRetry,
  formatModelLabel,
  formatModelName,
  formatProviderLabel,
  isTransientModelLoadError,
  pickAvailableFallbackModel,
  resolveSelectedModel,
} from './model-catalog.ts'

export function useAvailableModels() {
  const models = useModelsStore((state) => state.models)
  const selectedModel = useShellStore((state) => state.selectedModel)
  const defaultModel = useModelsStore((state) => state.defaultModel)
  const apiKeyStatus = useModelsStore((state) => state.apiKeyStatus)
  const isLoading = useModelsStore((state) => state.isLoading)
  const error = useModelsStore((state) => state.error)
  const warnings = useModelsStore((state) => state.warnings)

  const applyModels = useCallback(
    (
      nextModels: AvailableModel[],
      nextDefault: string | null,
      hasConfiguredKey: boolean,
      nextWarnings: string[] = [],
    ) => {
      const nextSelected = resolveSelectedModel(
        nextModels,
        getDesktopSettings().selectedModel,
        nextDefault,
      )
      const hasAvailableModel = nextModels.some((model) => model.available)

      useModelsStore.getState().applyCatalog({
        models: nextModels,
        defaultModel: nextDefault,
        warnings: nextWarnings,
        apiKeyStatus: toApiKeyStatus(hasConfiguredKey, hasAvailableModel),
      })
      useShellStore.getState().setSelectedModel(nextSelected)
    },
    [],
  )

  const handleLoadFailure = useCallback((loadError: unknown) => {
    const message =
      loadError instanceof Error ? loadError.message : 'Could not load available models.'

    useModelsStore
      .getState()
      .clearCatalog(message, isTransientModelLoadError(loadError) ? 'checking' : 'invalid')
    useShellStore.getState().setSelectedModel('')
  }, [])

  const loadModels = useCallback(async () => {
    const modelsStore = useModelsStore.getState()
    modelsStore.setLoading(true)
    modelsStore.setError('')
    modelsStore.setWarnings([])

    try {
      const {
        health,
        defaultModel: nextDefault,
        models: nextModels,
        warnings: nextWarnings,
      } = await fetchModelCatalog()

      applyModels(nextModels, nextDefault, Boolean(health.apiKey?.configured), nextWarnings)
    } catch (loadError) {
      handleLoadFailure(loadError)
    } finally {
      useModelsStore.getState().setLoading(false)
    }
  }, [applyModels, handleLoadFailure])

  // react-doctor-disable-next-line react-doctor/no-fetch-in-effect -- one-shot model catalog fetch with AbortController cleanup; project has no data-fetching library (rule's documented suppression)
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    const load = async () => {
      const modelsStore = useModelsStore.getState()
      modelsStore.setLoading(true)
      modelsStore.setError('')
      modelsStore.setWarnings([])

      try {
        const {
          health,
          defaultModel: nextDefault,
          models: nextModels,
          warnings: nextWarnings,
        } = await fetchModelCatalogWithRetry({ signal: controller.signal })

        if (cancelled) {
          return
        }

        applyModels(nextModels, nextDefault, Boolean(health.apiKey?.configured), nextWarnings)
      } catch (loadError) {
        if (cancelled) {
          return
        }

        handleLoadFailure(loadError)
      } finally {
        useModelsStore.getState().setLoading((current) => (cancelled ? current : false))
      }
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [applyModels, handleLoadFailure])

  const setSelectedModel = useCallback((modelId: string) => {
    if (!modelId) {
      useShellStore.getState().setSelectedModel('')
      return
    }

    const model = useModelsStore.getState().models.find((entry) => entry.id === modelId)
    if (!model?.available) {
      return
    }

    useShellStore.getState().setSelectedModel(modelId)
  }, [])

  const selectedModelInfo = models.find((model) => model.id === selectedModel)
  const canGenerate = Boolean(selectedModelInfo?.available)

  return {
    apiKeyStatus,
    canGenerate,
    defaultModel,
    error,
    isLoading,
    loadModels,
    models,
    selectedModel,
    setSelectedModel,
    warnings,
  }
}
