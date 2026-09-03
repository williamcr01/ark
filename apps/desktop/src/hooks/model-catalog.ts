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

export const toApiKeyStatus = (
  hasConfiguredKey: boolean,
  hasAvailableModel: boolean,
): ApiKeyStatus => {
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

  return null
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

  return available.toSorted((left, right) => {
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
 * Ids missing from `models[]` (or an empty catalog) resolve to '' so the client
 * clears the persisted selection instead of keeping a stale `provider:modelId`.
 */
export const resolveSelectedModel = (
  models: AvailableModel[],
  storedModel: string | null,
  defaultModel: string | null,
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
    return defaultEntry.id
  }

  return pickAvailableFallbackModel(models) ?? ''
}

const TRANSIENT_LOAD_ERROR =
  /failed to fetch|network|unreadable response|could not reach the ark api/i

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const isTransientModelLoadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return TRANSIENT_LOAD_ERROR.test(message)
}

async function fetchHealth(signal?: AbortSignal) {
  const response = await fetch('/api/health', { signal })
  return fetchApiJsonOrThrow(response, healthResponseSchema, {
    fallbackMessage: 'Could not reach the Ark API server.',
  })
}

async function fetchAvailableModels(signal?: AbortSignal) {
  const response = await fetch('/api/models', { signal })
  const data = await fetchApiJsonOrThrow(response, modelsResponseSchema, {
    fallbackMessage: 'Could not load available models.',
  })

  return {
    defaultModel: data.defaultModel,
    models: data.models,
    warnings: data.warnings,
  }
}

export async function fetchModelCatalog(signal?: AbortSignal) {
  const [health, { defaultModel, models, warnings }] = await Promise.all([
    fetchHealth(signal),
    fetchAvailableModels(signal),
  ])

  return {
    health,
    defaultModel,
    models,
    warnings,
  }
}

export async function fetchModelCatalogWithRetry(
  options: { retries?: number; delayMs?: number; signal?: AbortSignal } = {},
) {
  const { retries = 5, delayMs = 200, signal } = options
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchModelCatalog(signal)
    } catch (error) {
      lastError = error

      if (!isTransientModelLoadError(error) || attempt === retries) {
        throw error
      }

      await sleep(delayMs * (attempt + 1))
    }
  }

  throw lastError
}

export const formatModelLabel = (model: AvailableModel) =>
  model.name ? `${model.provider} · ${model.name}` : model.id

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
}

export const formatProviderLabel = (provider: ProviderId) => PROVIDER_LABELS[provider]

export const formatModelName = (model: AvailableModel) => model.name?.trim() || model.modelId

export const EMPTY_MODEL_CATALOG_COPY = 'Add an API key in Settings'
