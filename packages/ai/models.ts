import type { ModelInfo } from './model-info.ts'
import {
  ALL_PROVIDERS,
  providerIdSchema,
  type FirstPartyProviderId,
  type ProviderId,
} from './provider-id.ts'
import type { ReasoningEffort } from './reasoning-effort.ts'
import { getProviderApiKey, parseProviderHttpError, PROVIDER_LABELS } from './credentials.ts'
import {
  DEFAULT_MODEL_REF,
  MODEL_CATALOG,
  setDiscoveredCatalogEntries,
  toModelRef,
  type ModelCatalogEntry,
} from './model-catalog.ts'
import { listOpenRouterCatalogEntries } from './openrouter-models.ts'

export type { ProviderId, ModelInfo }

export const MODEL_CATALOG_TTL_MS = 10 * 60 * 1000

const catalogEntryToModelInfo = (entry: ModelCatalogEntry): ModelInfo => {
  const reasoningEfforts = [...entry.reasoningEfforts] as ReasoningEffort[]

  return {
    id: toModelRef(entry.provider, entry.modelId),
    provider: entry.provider,
    modelId: entry.modelId,
    name: entry.name,
    available: true,
    reasoningEfforts,
    ...(entry.defaultReasoningEffort
      ? { defaultReasoningEffort: entry.defaultReasoningEffort }
      : {}),
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
    const parsedProvider = providerIdSchema.safeParse(trimmed.slice(0, separatorIndex))
    const modelId = trimmed.slice(separatorIndex + 1).trim()

    if (parsedProvider.success && modelId.length > 0) {
      return { provider: parsedProvider.data, modelId }
    }
  }

  return {
    provider: fallbackProvider,
    modelId: trimmed,
  }
}

/** Env/boot default used by `/api/health`. Catalog default may be null when nothing is available. */
export const getDefaultModel = () => {
  const configured = process.env.ARK_DEFAULT_MODEL?.trim()
  if (configured) {
    const { provider, modelId } = parseModelRef(configured)
    return `${provider}:${modelId}`
  }

  return DEFAULT_MODEL_REF
}

export const pickCatalogDefaultModel = (models: readonly ModelInfo[]): string | null => {
  if (models.length === 0) {
    return null
  }

  const configured = process.env.ARK_DEFAULT_MODEL?.trim()
  if (configured) {
    const { provider, modelId } = parseModelRef(configured)
    const ref = `${provider}:${modelId}`
    if (models.some((model) => model.id === ref)) {
      return ref
    }
  }

  if (models.some((model) => model.id === DEFAULT_MODEL_REF)) {
    return DEFAULT_MODEL_REF
  }

  return models[0]?.id ?? null
}

export type ModelCatalog = {
  models: ModelInfo[]
  warnings: string[]
  defaultModel: string | null
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

const FIRST_PARTY_LISTERS: Record<FirstPartyProviderId, (apiKey: string) => Promise<Set<string>>> =
  {
    openai: listOpenAIModelIds,
    anthropic: listAnthropicModelIds,
    google: listGoogleModelIds,
  }

export async function testProviderApiKey(provider: ProviderId, apiKey: string) {
  const trimmed = apiKey.trim()

  if (provider === 'openrouter') {
    const entries = await listOpenRouterCatalogEntries(trimmed)
    return { modelCount: entries.length }
  }

  const ids = await FIRST_PARTY_LISTERS[provider](trimmed)
  return { modelCount: ids.size }
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
    return `Could not reach ${label} to list models.`
  }

  if (!message) {
    return `Could not list ${label} models.`
  }

  if (message.includes(label) || /api key/i.test(message)) {
    return message
  }

  return `Could not list ${label} models: ${message}`
}

type ProviderAccess =
  | { ok: true; kind: 'first-party'; ids: Set<string> }
  | { ok: true; kind: 'openrouter'; entries: ModelCatalogEntry[] }
  | { ok: false }

let modelCatalogCache: ModelCatalog | null = null
let modelCatalogCachedAt = 0
let modelCatalogInflight: Promise<ModelCatalog> | null = null

export const clearModelCatalogCache = () => {
  modelCatalogCache = null
  modelCatalogCachedAt = 0
  modelCatalogInflight = null
  setDiscoveredCatalogEntries([])
}

const unavailableModelError = (modelRef: string) =>
  Object.assign(new Error(`Model ${modelRef} is not available.`), {
    apiError: {
      code: 'provider_error' as const,
      error: `Model ${modelRef} is not available.`,
    },
  })

const missingProviderKeyError = (provider: ProviderId) =>
  Object.assign(new Error(`No API key configured for ${PROVIDER_LABELS[provider]}.`), {
    apiError: {
      code: 'missing_api_key' as const,
      error: `No API key configured for ${PROVIDER_LABELS[provider]}.`,
    },
  })

/** Reject model refs whose provider has no key or that are missing from the available catalog. */
export async function assertModelAvailable(modelRef: string): Promise<ModelInfo> {
  const { provider, modelId } = parseModelRef(modelRef)
  const ref = `${provider}:${modelId}`

  if (!getProviderApiKey(provider)) {
    throw missingProviderKeyError(provider)
  }

  const catalog = await getModelCatalog()
  const model = catalog.models.find((entry) => entry.id === ref)

  if (!model) {
    throw unavailableModelError(ref)
  }

  return model
}

/**
 * Build the available-only model catalog. Unkeyed providers are omitted.
 * Keyed providers that fail to list contribute a warning and no rows.
 * First-party rows are curated `MODEL_CATALOG` ∩ live ids; OpenRouter is live-filtered.
 */
export async function fetchAllAvailableModels(): Promise<ModelCatalog> {
  const warnings: string[] = []
  const accessByProvider = new Map<ProviderId, ProviderAccess>()

  await Promise.all(
    ALL_PROVIDERS.map(async (provider) => {
      const apiKey = getProviderApiKey(provider)

      if (!apiKey) {
        return
      }

      try {
        if (provider === 'openrouter') {
          const entries = await listOpenRouterCatalogEntries(apiKey)
          accessByProvider.set(provider, { ok: true, kind: 'openrouter', entries })
          return
        }

        const ids = await FIRST_PARTY_LISTERS[provider](apiKey)
        accessByProvider.set(provider, { ok: true, kind: 'first-party', ids })
      } catch (error) {
        warnings.push(formatModelCatalogWarning(provider, error))
        accessByProvider.set(provider, { ok: false })
      }
    }),
  )

  const models: ModelInfo[] = []
  const discovered: ModelCatalogEntry[] = []

  for (const provider of ALL_PROVIDERS) {
    const access = accessByProvider.get(provider)
    if (!access || !access.ok) {
      continue
    }

    if (access.kind === 'openrouter') {
      for (const entry of access.entries) {
        discovered.push(entry)
        models.push(catalogEntryToModelInfo(entry))
      }
      continue
    }

    for (const entry of MODEL_CATALOG) {
      if (entry.provider !== provider) {
        continue
      }

      if (catalogModelAccessible(entry.modelId, access.ids)) {
        models.push(catalogEntryToModelInfo(entry))
      }
    }
  }

  setDiscoveredCatalogEntries(discovered)

  return {
    models,
    warnings,
    defaultModel: pickCatalogDefaultModel(models),
  }
}

/** Fetch provider access and replace the process-local cache. */
export async function refreshModelCatalog(): Promise<ModelCatalog> {
  const catalog = await fetchAllAvailableModels()
  modelCatalogCache = catalog
  modelCatalogCachedAt = Date.now()
  return catalog
}

const cacheIsFresh = () =>
  Boolean(modelCatalogCache) && Date.now() - modelCatalogCachedAt < MODEL_CATALOG_TTL_MS

/**
 * Return the cached catalog, sharing one in-flight refresh when empty or stale.
 * Call {@link warmModelCatalog} at process startup so page reloads stay local.
 * Cache lives ~10 minutes and is cleared on credential changes.
 */
export async function getModelCatalog(): Promise<ModelCatalog> {
  if (cacheIsFresh() && modelCatalogCache) {
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
