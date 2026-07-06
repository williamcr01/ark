import { useCallback, useEffect, useState } from 'react'

import type { ApiErrorCode, ProviderId } from '../../shared/api/common.ts'
import type { ModelInfo } from '../../shared/api/health.ts'
import { healthResponseSchema, modelsResponseSchema } from '../../shared/api/health.ts'
import { ApiResponseError, fetchApiJsonOrThrow } from '../../shared/api/fetch.ts'

export type { ProviderId, ApiErrorCode }
export type AvailableModel = ModelInfo

export type ApiKeyStatus = 'checking' | 'missing' | 'invalid' | 'valid'

const SELECTED_MODEL_STORAGE_KEY = 'ark:selected-model'

const MISSING_KEY_MESSAGE =
  'No API keys configured. Add at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY to .env and restart the dev server.'

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

const resolveSelectedModel = (
  models: AvailableModel[],
  storedModel: string | null,
  defaultModel: string,
) => {
  const preferred =
    resolveStoredModel(models, storedModel) ??
    (models.some((model) => model.id === defaultModel) ? defaultModel : null)

  if (preferred) {
    const preferredModel = models.find((model) => model.id === preferred)
    if (preferredModel?.available) {
      return preferred
    }
  }

  return models.find((model) => model.available)?.id ?? preferred ?? ''
}

async function fetchHealth() {
  const response = await fetch('/api/health')
  return fetchApiJsonOrThrow(response, healthResponseSchema, {
    fallbackMessage: 'Could not reach the Ark API server.',
  })
}

async function fetchAvailableModels() {
  const response = await fetch('/api/models')

  try {
    const data = await fetchApiJsonOrThrow(response, modelsResponseSchema, {
      fallbackMessage: 'Could not load available models.',
    })

    return {
      defaultModel: data.defaultModel,
      models: data.models,
      warnings: data.warnings,
    }
  } catch (error) {
    if (error instanceof ApiResponseError && error.code) {
      throw Object.assign(error, { code: error.code })
    }

    throw error
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
      setError(hasConfiguredKey ? '' : MISSING_KEY_MESSAGE)

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

  const setSelectedModel = useCallback((modelId: string) => {
    setSelectedModelState(modelId)
    writeStoredModel(modelId)
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

export const formatModelLabel = (model: AvailableModel) => {
  const label = model.name ? `${model.provider} · ${model.name}` : model.id

  if (model.available) {
    return label
  }

  if (model.unavailableReason === 'not_found') {
    return `${label} (unavailable)`
  }

  return `${label} (add API key)`
}
