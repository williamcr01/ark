import type { ModelInfo, ProviderId } from '@ark/contracts'
import { getProviderApiKey, parseProviderHttpError, PROVIDER_LABELS } from './credentials.ts'

export type { ProviderId, ModelInfo }

type ModelUnavailableReason = NonNullable<ModelInfo['unavailableReason']>

const OPENAI_CHAT_MODEL_PATTERN = /^(gpt-|o[0-9]|chatgpt-)/i

/**
 * Shared markers for non-chat / non-agent models across OpenAI, Anthropic, and Google.
 * Matched as case-insensitive substrings of the provider model id.
 */
const NON_CHAT_MODEL_SUBSTRINGS = [
  'embed',
  'embedding',
  'image',
  'imagen',
  'veo',
  'nano-banana',
  'tts',
  'lyria',
  'robotics',
  'aqa',
  'whisper',
  'video',
  'dall-e',
  'sora',
  'realtime',
  'transcribe',
  'moderation',
  'audio',
  'computer-use',
] as const

const hasNonChatModelMarker = (normalizedId: string) =>
  NON_CHAT_MODEL_SUBSTRINGS.some((part) => normalizedId.includes(part))

/** OpenAI-only legacy / specialty prefixes not covered by the shared substring list. */
const OPENAI_EXCLUDED_PREFIXES = ['davinci', 'babbage', 'gpt-3.5-turbo-instruct', 'ft:', 'codex-']

/** Keep chat/tool-calling OpenAI models; drop embeddings, media, and specialty SKUs. */
export const isOpenAIChatModel = (id: string) => {
  const normalized = id.toLowerCase()

  if (hasNonChatModelMarker(normalized)) {
    return false
  }

  if (OPENAI_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false
  }

  return OPENAI_CHAT_MODEL_PATTERN.test(normalized)
}

/** Keep Claude chat models from Anthropic's Models API. */
export const isAnthropicChatModel = (id: string) => {
  const normalized = id.toLowerCase()

  if (!normalized.startsWith('claude')) {
    return false
  }

  return !hasNonChatModelMarker(normalized)
}

/**
 * Keep stable Gemini chat models suitable for generateContent + tools.
 * Drops shared non-chat markers plus Google preview/exp/revision aliases.
 */
export const isGoogleChatModel = (id: string) => {
  const normalized = id.toLowerCase()

  if (!normalized.startsWith('gemini')) {
    return false
  }

  if (hasNonChatModelMarker(normalized)) {
    return false
  }

  if (normalized.includes('-preview') || normalized.includes('-exp')) {
    return false
  }

  // Drop dated numeric revisions (gemini-1.5-flash-001) when a base SKU exists.
  if (/-\d{3}$/.test(normalized)) {
    return false
  }

  return true
}

const toModelRef = (
  provider: ProviderId,
  modelId: string,
  name?: string,
  available = true,
  unavailableReason?: ModelUnavailableReason,
): ModelInfo => ({
  id: `${provider}:${modelId}`,
  provider,
  modelId,
  name,
  available,
  unavailableReason: available ? undefined : unavailableReason,
})

const PROVIDER_SEED_MODELS: Record<ProviderId, Array<{ modelId: string; name: string }>> = {
  openai: [
    { modelId: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { modelId: 'gpt-4o', name: 'GPT-4o' },
    { modelId: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
    { modelId: 'gpt-4.1', name: 'GPT-4.1' },
  ],
  anthropic: [
    { modelId: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
    { modelId: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    { modelId: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
  ],
  google: [
    { modelId: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
    { modelId: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
    { modelId: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  ],
}

const seedModelsForProvider = (provider: ProviderId) =>
  PROVIDER_SEED_MODELS[provider].map((entry) =>
    toModelRef(provider, entry.modelId, entry.name, false, 'missing_api_key'),
  )

const sortModels = (models: ModelInfo[]) =>
  [...models].sort((left, right) => {
    const providerOrder = left.provider.localeCompare(right.provider)
    if (providerOrder !== 0) {
      return providerOrder
    }

    return left.modelId.localeCompare(right.modelId)
  })

export const parseModelRef = (
  value: string,
  fallbackProvider: ProviderId = 'openai',
): { provider: ProviderId; modelId: string } => {
  const trimmed = value.trim()
  const separatorIndex = trimmed.indexOf(':')

  if (separatorIndex > 0) {
    const provider = trimmed.slice(0, separatorIndex) as ProviderId
    const modelId = trimmed.slice(separatorIndex + 1).trim()

    if (
      (provider === 'openai' || provider === 'anthropic' || provider === 'google') &&
      modelId.length > 0
    ) {
      return { provider, modelId }
    }
  }

  return {
    provider: fallbackProvider,
    modelId: trimmed,
  }
}

export const getDefaultModel = () => {
  const configured = process.env.ARK_DEFAULT_MODEL?.trim()
  if (configured) {
    const { provider, modelId } = parseModelRef(configured)
    return `${provider}:${modelId}`
  }

  const openaiModel = process.env.OPENAI_MODEL?.trim()
  if (openaiModel) {
    return `openai:${openaiModel}`
  }

  return 'openai:gpt-4o-mini'
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const apiError = parseProviderHttpError('openai', response.status, body)
    throw Object.assign(new Error(apiError.error), { apiError })
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string }>
  }

  return sortModels(
    (payload.data ?? [])
      .map((entry) => entry.id?.trim() ?? '')
      .filter((id) => id.length > 0 && isOpenAIChatModel(id))
      .map((modelId) => toModelRef('openai', modelId, undefined, true)),
  )
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const models: ModelInfo[] = []
  let afterId: string | undefined

  do {
    const url = new URL('https://api.anthropic.com/v1/models')
    url.searchParams.set('limit', '100')
    if (afterId) {
      url.searchParams.set('after_id', afterId)
    }

    const response = await fetch(url, {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const apiError = parseProviderHttpError('anthropic', response.status, body)
      throw Object.assign(new Error(apiError.error), { apiError })
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string; display_name?: string }>
      has_more?: boolean
      last_id?: string
    }

    for (const entry of payload.data ?? []) {
      const modelId = entry.id?.trim() ?? ''
      if (!modelId || !isAnthropicChatModel(modelId)) {
        continue
      }

      models.push(toModelRef('anthropic', modelId, entry.display_name?.trim(), true))
    }

    afterId = payload.has_more ? payload.last_id : undefined
  } while (afterId)

  return sortModels(models)
}

async function fetchGoogleModels(apiKey: string): Promise<ModelInfo[]> {
  const models: ModelInfo[] = []
  let pageToken: string | undefined

  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
    url.searchParams.set('key', apiKey)
    url.searchParams.set('pageSize', '100')
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const response = await fetch(url)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const apiError = parseProviderHttpError('google', response.status, body)
      throw Object.assign(new Error(apiError.error), { apiError })
    }

    const payload = (await response.json()) as {
      models?: Array<{
        name?: string
        displayName?: string
        supportedGenerationMethods?: string[]
      }>
      nextPageToken?: string
    }

    for (const entry of payload.models ?? []) {
      const rawName = entry.name?.trim() ?? ''
      const modelId = rawName.replace(/^models\//, '')
      const supportsGenerate = entry.supportedGenerationMethods?.includes('generateContent')

      if (!modelId || !supportsGenerate || !isGoogleChatModel(modelId)) {
        continue
      }

      models.push(toModelRef('google', modelId, entry.displayName?.trim() || undefined, true))
    }

    pageToken = payload.nextPageToken
  } while (pageToken)

  return sortModels(models)
}

const PROVIDER_FETCHERS: Record<ProviderId, (apiKey: string) => Promise<ModelInfo[]>> = {
  openai: fetchOpenAIModels,
  anthropic: fetchAnthropicModels,
  google: fetchGoogleModels,
}

export async function fetchProviderModels(provider: ProviderId): Promise<ModelInfo[]> {
  const apiKey = getProviderApiKey(provider)
  if (!apiKey) {
    return []
  }

  return PROVIDER_FETCHERS[provider](apiKey)
}

const ALL_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'google']

export const formatModelCatalogWarning = (provider: ProviderId, error: unknown): string => {
  const label = PROVIDER_LABELS[provider]
  const message = error instanceof Error ? error.message.trim() : ''

  if (
    /fetch failed/i.test(message) ||
    /network/i.test(message) ||
    /econnreset/i.test(message) ||
    /enotfound/i.test(message) ||
    /econnrefused/i.test(message)
  ) {
    return `Could not reach ${label} to load models. Showing fallback models until the network is available.`
  }

  if (!message) {
    return `Could not load ${label} models.`
  }

  // HTTP/API errors from parseProviderHttpError already name the provider when relevant.
  if (message.includes(label) || /api key/i.test(message)) {
    return message
  }

  return `Could not load ${label} models: ${message}`
}

export type ModelCatalog = {
  models: ModelInfo[]
  warnings: string[]
}

let modelCatalogCache: ModelCatalog | null = null
let modelCatalogInflight: Promise<ModelCatalog> | null = null

export const clearModelCatalogCache = () => {
  modelCatalogCache = null
  modelCatalogInflight = null
}

export async function fetchAllAvailableModels(): Promise<ModelCatalog> {
  const warnings: string[] = []
  const models: ModelInfo[] = []

  await Promise.all(
    ALL_PROVIDERS.map(async (provider) => {
      const apiKey = getProviderApiKey(provider)

      if (!apiKey) {
        models.push(...seedModelsForProvider(provider))
        return
      }

      try {
        const providerModels = await PROVIDER_FETCHERS[provider](apiKey)
        models.push(...providerModels)
      } catch (error) {
        warnings.push(formatModelCatalogWarning(provider, error))
        models.push(
          ...PROVIDER_SEED_MODELS[provider].map((entry) =>
            toModelRef(provider, entry.modelId, entry.name, false, 'not_found'),
          ),
        )
      }
    }),
  )

  return {
    models: sortModels(models),
    warnings,
  }
}

/** Fetch provider catalogs and replace the process-local cache. */
export async function refreshModelCatalog(): Promise<ModelCatalog> {
  const catalog = await fetchAllAvailableModels()
  modelCatalogCache = catalog
  return catalog
}

/**
 * Return the cached catalog, sharing one in-flight refresh when empty.
 * Call {@link warmModelCatalog} at process startup so page reloads stay local.
 */
export async function getModelCatalog(): Promise<ModelCatalog> {
  if (modelCatalogCache) {
    return modelCatalogCache
  }

  if (!modelCatalogInflight) {
    modelCatalogInflight = refreshModelCatalog().finally(() => {
      modelCatalogInflight = null
    })
  }

  return modelCatalogInflight
}

/** Best-effort warm of the catalog during API boot. */
export async function warmModelCatalog(): Promise<void> {
  try {
    await refreshModelCatalog()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown model catalog error.'
    console.warn(`Model catalog warm failed: ${message}`)
  }
}

export function ensureModelInList(models: ModelInfo[], modelRef: string): ModelInfo[] {
  if (models.some((model) => model.id === modelRef)) {
    return models
  }

  const { provider, modelId } = parseModelRef(modelRef)
  const unavailableReason: ModelUnavailableReason = getProviderApiKey(provider)
    ? 'not_found'
    : 'missing_api_key'

  return sortModels([...models, toModelRef(provider, modelId, undefined, false, unavailableReason)])
}
