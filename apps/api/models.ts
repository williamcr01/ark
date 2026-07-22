import type { ModelInfo, ProviderId, ReasoningEffort } from '@ark/contracts'
import { getProviderApiKey } from './credentials.ts'
import {
  DEFAULT_MODEL_REF,
  findCatalogEntry,
  MODEL_CATALOG,
  toModelRef,
  type ModelCatalogEntry,
} from './model-catalog.ts'

export type { ProviderId, ModelInfo }

type ModelUnavailableReason = NonNullable<ModelInfo['unavailableReason']>

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

/** Build the curated model catalog; availability is keyed only on configured API keys. */
export async function fetchAllAvailableModels(): Promise<ModelCatalog> {
  const models = MODEL_CATALOG.map((entry) => {
    const hasKey = Boolean(getProviderApiKey(entry.provider))
    return catalogEntryToModelInfo(entry, hasKey, hasKey ? undefined : 'missing_api_key')
  })

  return {
    models,
    warnings: [],
  }
}

export async function getModelCatalog(): Promise<ModelCatalog> {
  return fetchAllAvailableModels()
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
      catalogEntryToModelInfo(catalogEntry, hasKey, hasKey ? undefined : 'missing_api_key'),
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
    },
  ]
}
