import type { ModelInfo, ProviderId, ReasoningEffort } from '@ark/contracts'
import { getProviderApiKey, parseProviderHttpError, PROVIDER_LABELS } from './credentials.ts'
import {
  DEFAULT_MODEL_REF,
  findCatalogEntry,
  MODEL_CATALOG,
  toModelRef,
  type ModelCatalogEntry,
} from './model-catalog.ts'

export type { ProviderId, ModelInfo }

type ModelUnavailableReason = NonNullable<ModelInfo['unavailableReason']>

const ALL_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'google']

const catalogEntryToModelInfo = (
  entry: ModelCatalogEntry,
  available: boolean,
  unavailableReason?: ModelUnavailableReason,
): ModelInfo => {
  const reasoningEfforts = [...entry.reasoningEfforts] as ReasoningEffort[]
  const supportsReasoning = reasoningEfforts.length > 0

  return {
    id: toModelRef(entry.provider, entry.modelId),
    provider: entry.provider,
    modelId: entry.modelId,
    name: entry.name,
    available,
    unavailableReason: available ? undefined : unavailableReason,
    reasoningEfforts,
    ...(entry.defaultReasoningEffort
      ? { defaultReasoningEffort: entry.defaultReasoningEffort }
      : {}),
    supportsReasoning,
    supportsAttachments: entry.supportsAttachments !== false,
  }
}

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

  return DEFAULT_MODEL_REF
}

export type ModelCatalog = {
  models: ModelInfo[]
  warnings: string[]
}

/** True when the suffix looks like a dated/versioned alias (e.g. claude-sonnet-5-20250514). */
const isVersionedAliasSuffix = (suffix: string) => /^\d/.test(suffix)

/** True when a catalog SKU is present in a provider list (exact or versioned alias). */
export function catalogModelAccessible(modelId: string, accessibleIds: ReadonlySet<string>) {
  if (accessibleIds.has(modelId)) {
    return true
  }

  for (const id of accessibleIds) {
    if (id.startsWith(`${modelId}-`) && isVersionedAliasSuffix(id.slice(modelId.length + 1))) {
      return true
    }
    if (modelId.startsWith(`${id}-`) && isVersionedAliasSuffix(modelId.slice(id.length + 1))) {
      return true
    }
  }

  return false
}

async function listOpenAIModelIds(apiKey: string): Promise<Set<string>> {
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

  const payload = (await response.json()) as { data?: Array<{ id?: string }> }
  return new Set(
    (payload.data ?? []).map((entry) => entry.id?.trim() ?? '').filter((id) => id.length > 0),
  )
}

async function listAnthropicModelIds(apiKey: string): Promise<Set<string>> {
  const ids = new Set<string>()
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
      data?: Array<{ id?: string }>
      has_more?: boolean
      last_id?: string
    }

    for (const entry of payload.data ?? []) {
      const modelId = entry.id?.trim() ?? ''
      if (modelId) {
        ids.add(modelId)
      }
    }

    afterId = payload.has_more ? payload.last_id : undefined
  } while (afterId)

  return ids
}

async function listGoogleModelIds(apiKey: string): Promise<Set<string>> {
  const ids = new Set<string>()
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
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>
      nextPageToken?: string
    }

    for (const entry of payload.models ?? []) {
      const rawName = entry.name?.trim() ?? ''
      const modelId = rawName.replace(/^models\//, '')
      const supportsGenerate = entry.supportedGenerationMethods?.includes('generateContent')

      if (modelId && supportsGenerate) {
        ids.add(modelId)
      }
    }

    pageToken = payload.nextPageToken
  } while (pageToken)

  return ids
}

const PROVIDER_LISTERS: Record<ProviderId, (apiKey: string) => Promise<Set<string>>> = {
  openai: listOpenAIModelIds,
  anthropic: listAnthropicModelIds,
  google: listGoogleModelIds,
}

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
    return `Could not reach ${label} to verify models. Showing them as unavailable until the network is available.`
  }

  if (!message) {
    return `Could not verify ${label} models.`
  }

  if (message.includes(label) || /api key/i.test(message)) {
    return message
  }

  return `Could not verify ${label} models: ${message}`
}

let modelCatalogCache: ModelCatalog | null = null
let modelCatalogInflight: Promise<ModelCatalog> | null = null

export const clearModelCatalogCache = () => {
  modelCatalogCache = null
  modelCatalogInflight = null
}

/**
 * Build the curated model catalog. Availability requires a configured key and a
 * successful provider probe that includes the catalog SKU (or a versioned alias).
 */
export async function fetchAllAvailableModels(): Promise<ModelCatalog> {
  const warnings: string[] = []
  const accessByProvider = new Map<ProviderId, { ok: true; ids: Set<string> } | { ok: false }>()

  await Promise.all(
    ALL_PROVIDERS.map(async (provider) => {
      const apiKey = getProviderApiKey(provider)

      if (!apiKey) {
        return
      }

      try {
        const ids = await PROVIDER_LISTERS[provider](apiKey)
        accessByProvider.set(provider, { ok: true, ids })
      } catch (error) {
        warnings.push(formatModelCatalogWarning(provider, error))
        accessByProvider.set(provider, { ok: false })
      }
    }),
  )

  const models = MODEL_CATALOG.map((entry) => {
    const access = accessByProvider.get(entry.provider)

    if (!access) {
      return catalogEntryToModelInfo(entry, false, 'missing_api_key')
    }

    if (!access.ok) {
      return catalogEntryToModelInfo(entry, false, 'not_found')
    }

    const available = catalogModelAccessible(entry.modelId, access.ids)
    return catalogEntryToModelInfo(entry, available, available ? undefined : 'not_found')
  })

  return {
    models,
    warnings,
  }
}

/** Fetch provider access and replace the process-local cache. */
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
  } catch {
    // Boot continues; the next /api/models request retries.
  }
}

export function ensureModelInList(models: ModelInfo[], modelRef: string): ModelInfo[] {
  if (models.some((model) => model.id === modelRef)) {
    return models
  }

  const { provider, modelId } = parseModelRef(modelRef)
  const catalogEntry = findCatalogEntry(provider, modelId)

  if (catalogEntry) {
    const hasKey = Boolean(getProviderApiKey(provider))
    return [
      ...models,
      catalogEntryToModelInfo(catalogEntry, false, hasKey ? 'not_found' : 'missing_api_key'),
    ]
  }

  const unavailableReason: ModelUnavailableReason = getProviderApiKey(provider)
    ? 'not_found'
    : 'missing_api_key'

  return [
    ...models,
    {
      id: `${provider}:${modelId}`,
      provider,
      modelId,
      available: false,
      unavailableReason,
      reasoningEfforts: [],
      supportsReasoning: false,
      supportsAttachments: true,
    },
  ]
}
