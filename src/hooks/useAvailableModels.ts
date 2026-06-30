import { useCallback, useEffect, useState } from 'react'

export type ProviderId = 'openai' | 'anthropic' | 'google'

export type AvailableModel = {
  id: string
  provider: ProviderId
  modelId: string
  name?: string
}

export type ApiKeyStatus = 'checking' | 'missing' | 'invalid' | 'valid'

export type ApiErrorCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'provider_error'

type ModelsResponse = {
  models?: AvailableModel[]
  defaultModel?: string
  error?: string
  code?: ApiErrorCode
  warnings?: string[]
}

type HealthResponse = {
  ok?: boolean
  defaultModel?: string
  model?: string
  apiKey?: {
    configured?: boolean
  }
  providers?: Partial<Record<ProviderId, { configured?: boolean }>>
}

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

const toApiKeyStatus = (code?: ApiErrorCode): ApiKeyStatus => {
  if (code === 'missing_api_key') {
    return 'missing'
  }

  if (code === 'invalid_api_key') {
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

async function fetchHealth() {
  const response = await fetch('/api/health')
  const data = (await response.json().catch(() => ({}))) as HealthResponse

  if (!response.ok) {
    throw new Error('Could not reach the Ark API server.')
  }

  return data
}

async function fetchAvailableModels() {
  const response = await fetch('/api/models')
  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as ModelsResponse

  if (!response.ok) {
    const error = new Error(data.error ?? 'Could not load available models.')
    Object.assign(error, { code: data.code })
    throw error
  }

  return {
    defaultModel: data.defaultModel ?? data.models?.[0]?.id ?? '',
    models: data.models ?? [],
    warnings: data.warnings ?? [],
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
    (nextModels: AvailableModel[], nextDefault: string) => {
      const storedModel = resolveStoredModel(nextModels, readStoredModel())
      const nextSelected = storedModel ?? nextDefault

      setModels(nextModels)
      setDefaultModel(nextDefault)
      setSelectedModelState(nextSelected)

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

      if (!health.apiKey?.configured) {
        setApiKeyStatus('missing')
        setModels([])
        setSelectedModelState('')
        setDefaultModel(health.model ?? '')
        setError(MISSING_KEY_MESSAGE)
        return
      }

      const {
        defaultModel: nextDefault,
        models: nextModels,
        warnings: nextWarnings,
      } = await fetchAvailableModels()

      setApiKeyStatus('valid')
      setWarnings(nextWarnings)
      applyModels(nextModels, nextDefault)
    } catch (loadError) {
      const code =
        loadError &&
        typeof loadError === 'object' &&
        'code' in loadError &&
        typeof loadError.code === 'string'
          ? (loadError.code as ApiErrorCode)
          : undefined
      const message =
        loadError instanceof Error
          ? loadError.message
          : 'Could not load available models.'

      setApiKeyStatus(toApiKeyStatus(code))
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

        if (!health.apiKey?.configured) {
          setApiKeyStatus('missing')
          setModels([])
          setSelectedModelState('')
          setDefaultModel(health.model ?? '')
          setError(MISSING_KEY_MESSAGE)
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

        setApiKeyStatus('valid')
        setWarnings(nextWarnings)
        applyModels(nextModels, nextDefault)
      } catch (loadError) {
        if (cancelled) {
          return
        }

        const code =
          loadError &&
          typeof loadError === 'object' &&
          'code' in loadError &&
          typeof loadError.code === 'string'
            ? (loadError.code as ApiErrorCode)
            : undefined
        const message =
          loadError instanceof Error
            ? loadError.message
            : 'Could not load available models.'

        setApiKeyStatus(toApiKeyStatus(code))
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

  const canGenerate = apiKeyStatus === 'valid' && models.length > 0

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
  if (model.name) {
    return `${model.provider} · ${model.name}`
  }

  return model.id
}
