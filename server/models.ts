import {
  getConfiguredProviders,
  getProviderApiKey,
  parseProviderHttpError,
  type ProviderId,
} from './credentials.ts'

export type ModelInfo = {
  id: string
  provider: ProviderId
  modelId: string
  name?: string
}

const OPENAI_CHAT_MODEL_PATTERN = /^(gpt-|o[0-9]|chatgpt-)/i

const OPENAI_EXCLUDED_PREFIXES = [
  'text-embedding',
  'whisper',
  'tts',
  'dall-e',
  'davinci',
  'babbage',
  'gpt-image',
  'sora',
  'omni-moderation',
  'gpt-3.5-turbo-instruct',
  'ft:',
  'codex-',
]

const isOpenAIChatModel = (id: string) => {
  const normalized = id.toLowerCase()

  if (OPENAI_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false
  }

  return OPENAI_CHAT_MODEL_PATTERN.test(normalized)
}

const toModelRef = (provider: ProviderId, modelId: string, name?: string): ModelInfo => ({
  id: `${provider}:${modelId}`,
  provider,
  modelId,
  name,
})

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
      .map((modelId) => toModelRef('openai', modelId)),
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
      if (!modelId) {
        continue
      }

      models.push(toModelRef('anthropic', modelId, entry.display_name?.trim()))
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

      if (!modelId || !supportsGenerate || !/^gemini/i.test(modelId)) {
        continue
      }

      models.push(
        toModelRef('google', modelId, entry.displayName?.trim() || undefined),
      )
    }

    pageToken = payload.nextPageToken
  } while (pageToken)

  return sortModels(models)
}

const PROVIDER_FETCHERS: Record<
  ProviderId,
  (apiKey: string) => Promise<ModelInfo[]>
> = {
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

export async function fetchAllAvailableModels(): Promise<{
  models: ModelInfo[]
  warnings: string[]
}> {
  const providers = getConfiguredProviders()
  const warnings: string[] = []
  const models: ModelInfo[] = []

  await Promise.all(
    providers.map(async (provider) => {
      try {
        const providerModels = await fetchProviderModels(provider)
        models.push(...providerModels)
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : `Could not load ${provider} models.`
        warnings.push(message)
      }
    }),
  )

  return {
    models: sortModels(models),
    warnings,
  }
}

export function ensureModelInList(models: ModelInfo[], modelRef: string): ModelInfo[] {
  if (models.some((model) => model.id === modelRef)) {
    return models
  }

  const { provider, modelId } = parseModelRef(modelRef)
  return sortModels([...models, toModelRef(provider, modelId)])
}
