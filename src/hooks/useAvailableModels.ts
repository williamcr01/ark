import { useCallback, useEffect, useState } from 'react'

export type AvailableModel = {
  id: string
  name?: string
  ownedBy?: string
}

type ModelsResponse = {
  models?: AvailableModel[]
  defaultModel?: string
  error?: string
}

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

async function fetchAvailableModels() {
  const response = await fetch('/api/models')
  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as ModelsResponse

  if (!response.ok) {
    throw new Error(data.error ?? 'Could not load available models.')
  }

  return {
    defaultModel: data.defaultModel ?? data.models?.[0]?.id ?? '',
    models: data.models ?? [],
  }
}

export function useAvailableModels() {
  const [models, setModels] = useState<AvailableModel[]>([])
  const [selectedModel, setSelectedModelState] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const applyModels = useCallback(
    (nextModels: AvailableModel[], nextDefault: string) => {
      const storedModel = readStoredModel()
      const nextSelected =
        storedModel && nextModels.some((model) => model.id === storedModel)
          ? storedModel
          : nextDefault

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

    try {
      const { defaultModel: nextDefault, models: nextModels } =
        await fetchAvailableModels()
      applyModels(nextModels, nextDefault)
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : 'Could not load available models.'

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

      try {
        const { defaultModel: nextDefault, models: nextModels } =
          await fetchAvailableModels()

        if (cancelled) {
          return
        }

        applyModels(nextModels, nextDefault)
      } catch (loadError) {
        if (cancelled) {
          return
        }

        const message =
          loadError instanceof Error
            ? loadError.message
            : 'Could not load available models.'

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

  return {
    defaultModel,
    error,
    isLoading,
    loadModels,
    models,
    selectedModel,
    setSelectedModel,
  }
}
