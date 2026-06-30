import { parseOpenAIHttpError } from './api-key.ts'

export type ModelInfo = {
  id: string
  name?: string
  ownedBy?: string
}

const CHAT_MODEL_PATTERN =
  /^(gpt-|o[0-9]|chatgpt-)/i

const EXCLUDED_MODEL_PREFIXES = [
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

const isChatModel = (id: string) => {
  const normalized = id.toLowerCase()

  if (EXCLUDED_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false
  }

  return CHAT_MODEL_PATTERN.test(normalized)
}

const sortModels = (models: ModelInfo[]) =>
  [...models].sort((left, right) => left.id.localeCompare(right.id))

export const getDefaultModel = () => process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

export async function fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const apiError = parseOpenAIHttpError(response.status, body)
    throw Object.assign(new Error(apiError.error), { apiError })
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string; owned_by?: string }>
  }

  const models = (payload.data ?? [])
    .map((entry) => ({
      id: entry.id?.trim() ?? '',
      ownedBy: entry.owned_by,
    }))
    .filter((entry) => entry.id.length > 0 && isChatModel(entry.id))

  return sortModels(models)
}

export function ensureModelInList(models: ModelInfo[], modelId: string): ModelInfo[] {
  if (models.some((model) => model.id === modelId)) {
    return models
  }

  return sortModels([...models, { id: modelId }])
}
