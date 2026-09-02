import type { ModelCatalogEntry } from './model-catalog.ts'
import type { ReasoningEffort } from './reasoning-effort.ts'
import { parseProviderHttpError } from './credentials.ts'

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** Small effort set advertised for OpenRouter models that list reasoning support. */
export const OPENROUTER_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[]

export type OpenRouterArchitecture = {
  modality?: string
  input_modalities?: string[]
  output_modalities?: string[]
}

export type OpenRouterModelPayload = {
  id?: string
  name?: string
  architecture?: OpenRouterArchitecture
  supported_parameters?: string[]
}

export type OpenRouterModalities = {
  input: string[]
  output: string[]
}

const splitModalityPart = (part: string | undefined): string[] =>
  (part ?? '')
    .split('+')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)

/** Parse `text+image->text` style modality strings used by older OpenRouter payloads. */
export const parseOpenRouterModalityString = (modality: string): OpenRouterModalities => {
  const separatorIndex = modality.indexOf('->')
  if (separatorIndex < 0) {
    return { input: splitModalityPart(modality), output: [] }
  }

  return {
    input: splitModalityPart(modality.slice(0, separatorIndex)),
    output: splitModalityPart(modality.slice(separatorIndex + 2)),
  }
}

export const resolveOpenRouterModalities = (
  architecture: OpenRouterArchitecture | undefined,
): OpenRouterModalities => {
  const input = (architecture?.input_modalities ?? []).map((token) => token.trim().toLowerCase())
  const output = (architecture?.output_modalities ?? []).map((token) => token.trim().toLowerCase())

  if (input.length > 0 || output.length > 0) {
    return { input, output }
  }

  if (architecture?.modality?.trim()) {
    return parseOpenRouterModalityString(architecture.modality)
  }

  return { input: [], output: [] }
}

const hasTools = (parameters: readonly string[] | undefined) =>
  (parameters ?? []).some((parameter) => parameter.trim().toLowerCase() === 'tools')

const hasReasoningParameter = (parameters: readonly string[] | undefined) =>
  (parameters ?? []).some((parameter) => {
    const normalized = parameter.trim().toLowerCase()
    return normalized === 'reasoning' || normalized === 'reasoning_effort'
  })

const looksLikeEmbedding = (id: string, name: string) =>
  /embed/i.test(id) || /embedding/i.test(name)

/**
 * Keep chat/text models that can call tools. Drop image-to-image, audio-only,
 * and embedding-style rows even when they advertise other parameters.
 */
export const isOpenRouterChatToolsModel = (entry: OpenRouterModelPayload): boolean => {
  const id = entry.id?.trim() ?? ''
  if (!id) {
    return false
  }

  if (!hasTools(entry.supported_parameters)) {
    return false
  }

  const name = entry.name?.trim() ?? ''
  if (looksLikeEmbedding(id, name)) {
    return false
  }

  const { output } = resolveOpenRouterModalities(entry.architecture)
  // Chat models must emit text. Image→image and audio-only rows do not.
  return output.includes('text')
}

export const openRouterModelToCatalogEntry = (
  entry: OpenRouterModelPayload,
): ModelCatalogEntry | null => {
  if (!isOpenRouterChatToolsModel(entry)) {
    return null
  }

  const modelId = entry.id!.trim()
  const name = entry.name?.trim() || modelId
  const { input } = resolveOpenRouterModalities(entry.architecture)
  const supportsReasoning = hasReasoningParameter(entry.supported_parameters)

  return {
    provider: 'openrouter',
    modelId,
    name,
    reasoningEfforts: supportsReasoning ? OPENROUTER_REASONING_EFFORTS : [],
    ...(supportsReasoning ? { defaultReasoningEffort: 'medium' as const } : {}),
    reasoningTransport: supportsReasoning ? 'openai-effort' : 'none',
    supportsAttachments: input.includes('image'),
  }
}

export async function listOpenRouterCatalogEntries(apiKey: string): Promise<ModelCatalogEntry[]> {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/williamcr01/ark',
      'X-Title': 'Ark',
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const apiError = parseProviderHttpError('openrouter', response.status, body)
    throw Object.assign(new Error(apiError.error), { apiError })
  }

  const payload = (await response.json()) as { data?: OpenRouterModelPayload[] }
  const entries: ModelCatalogEntry[] = []

  for (const raw of payload.data ?? []) {
    const entry = openRouterModelToCatalogEntry(raw)
    if (entry) {
      entries.push(entry)
    }
  }

  return entries
}
