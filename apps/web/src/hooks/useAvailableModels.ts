import { useCallback, useEffect, useState } from 'react'

import {
  healthResponseSchema,
  modelsResponseSchema,
  fetchApiJsonOrThrow,
  type ApiErrorCode,
  type ModelInfo,
  type ProviderId,
} from '@ark/contracts'

export type { ProviderId, ApiErrorCode }
export type AvailableModel = ModelInfo

export type ApiKeyStatus = 'checking' | 'missing' | 'invalid' | 'valid'

const SELECTED_MODEL_STORAGE_KEY = 'ark:selected-model'

const readStoredModel = () => {
  try {
    return localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)
  } catch {
    return null
  }
}

const writeStoredModel = (modelId: string) => {
  try {
    localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, modelId)
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

const toApiKeyStatus = (hasConfiguredKey: boolean, hasAvailableModel: boolean): ApiKeyStatus => {
  if (!hasConfiguredKey) {
    return 'missing'
  }

  if (!hasAvailableModel) {
    return 'invalid'
  }

  return 'valid'
}

const resolveStoredModel = (models: AvailableModel[], storedModel: string | null) => {
  if (!storedModel) {
    return null
  }

  if (models.some((model) => model.id === storedModel)) {
    return storedModel
  }

  const legacyMatch = models.find((model) => model.modelId === storedModel)
  return legacyMatch?.id ?? null
}

/** Prefer faster/cheaper models when auto-picking a fallback. */
const fallbackPreferenceScore = (model: AvailableModel): number => {
  const id = model.modelId.toLowerCase()

  if (id.includes('flash-lite')) {
    return -1
  }

  if (/luna|mini|flash|haiku|nano/.test(id)) {
    return 0
  }

  if (/terra|sonnet|gpt-4o$|pro/.test(id)) {
    return 1
  }

  return 2
}

export const pickAvailableFallbackModel = (models: AvailableModel[]): string | null => {
  const available = models.filter((model) => model.available)

  if (available.length === 0) {
    return null
  }

  return [...available].sort((left, right) => {
    const scoreDiff = fallbackPreferenceScore(left) - fallbackPreferenceScore(right)
    if (scoreDiff !== 0) {
      return scoreDiff
    }

    const providerOrder = left.provider.localeCompare(right.provider)
    if (providerOrder !== 0) {
      return providerOrder
    }

    return left.modelId.localeCompare(right.modelId)
  })[0]!.id
}

/**
 * Resolve the active model for the selector.
 * Priority: available stored preference → available server default → cheap available fallback.
 * Unavailable preferences are never selected; generation recovery may still call loadModels().
 */
export const resolveSelectedModel = (
  models: AvailableModel[],
  storedModel: string | null,
  defaultModel: string,
) => {
  const stored = resolveStoredModel(models, storedModel)
  if (stored) {
    const storedEntry = models.find((model) => model.id === stored)
    if (storedEntry?.available) {
      return stored
    }
  }

  const defaultEntry = models.find((model) => model.id === defaultModel)
  if (defaultEntry?.available) {
    return defaultModel
  }

  return pickAvailableFallbackModel(models) ?? stored ?? defaultEntry?.id ?? ''
}

async function fetchHealth() {
  const response = await fetch('/api/health')
  return fetchApiJsonOrThrow(response, healthResponseSchema, {
    fallbackMessage: 'Could not reach the Ark API server.',
  })
}

async function fetchAvailableModels() {
  const response = await fetch('/api/models')
  const data = await fetchApiJsonOrThrow(response, modelsResponseSchema, {
    fallbackMessage: 'Could not load available models.',
  })

  return {
    defaultModel: data.defaultModel,
    models: data.models,
    warnings: data.warnings,
  }
}

export function useAvailableModels() {
  const [models, setModels] = useState<AvailableModel[]>([])
  const [selectedModel, setSelectedModelState] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>('checking')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])

  const applyModels = useCallback(
    (nextModels: AvailableModel[], nextDefault: string, hasConfiguredKey: boolean) => {
      const nextSelected = resolveSelectedModel(nextModels, readStoredModel(), nextDefault)
      const hasAvailableModel = nextModels.some((model) => model.available)

      setModels(nextModels)
      setDefaultModel(nextDefault)
      setSelectedModelState(nextSelected)
      setApiKeyStatus(toApiKeyStatus(hasConfiguredKey, hasAvailableModel))
      setError('')

      if (nextSelected) {
        writeStoredModel(nextSelected)
      }
    },
    [],
  )

  const loadModels = useCallback(async () => {
    setIsLoading(true)
    setError('')
    setWarnings([])

    try {
      const health = await fetchHealth()
      const {
        defaultModel: nextDefault,
        models: nextModels,
        warnings: nextWarnings,
      } = await fetchAvailableModels()

      setWarnings(nextWarnings)
      applyModels(nextModels, nextDefault, Boolean(health.apiKey?.configured))
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Could not load available models.'

      setApiKeyStatus('invalid')
      setModels([])
      setSelectedModelState('')
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [applyModels])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      setError('')
      setWarnings([])

      try {
        const health = await fetchHealth()

        if (cancelled) {
          return
        }

        const {
          defaultModel: nextDefault,
          models: nextModels,
          warnings: nextWarnings,
        } = await fetchAvailableModels()

        if (cancelled) {
          return
        }

        setWarnings(nextWarnings)
        applyModels(nextModels, nextDefault, Boolean(health.apiKey?.configured))
      } catch (loadError) {
        if (cancelled) {
          return
        }

        const message =
          loadError instanceof Error ? loadError.message : 'Could not load available models.'

        setApiKeyStatus('invalid')
        setModels([])
        setSelectedModelState('')
        setError(message)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [applyModels])

  const setSelectedModel = useCallback(
    (modelId: string) => {
      const model = models.find((entry) => entry.id === modelId)
      if (model && !model.available) {
        return
      }

      setSelectedModelState(modelId)
      writeStoredModel(modelId)
    },
    [models],
  )

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

export const formatModelLabel = (model: AvailableModel) => {
  const label = model.name ? `${model.provider} · ${model.name}` : model.id

  if (model.available) {
    return label
  }

  if (model.unavailableReason === 'missing_api_key') {
    return `${label} (no API key)`
  }

  return `${label} (unavailable)`
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
}

export const formatModelName = (model: AvailableModel) => model.name?.trim() || model.modelId

export const formatProviderLabel = (provider: ProviderId) => PROVIDER_LABELS[provider]

export const formatUnavailableBadge = (model: AvailableModel) => {
  if (model.available) {
    return null
  }

  if (model.unavailableReason === 'missing_api_key') {
    return 'No API key'
  }

  return 'Unavailable'
}
