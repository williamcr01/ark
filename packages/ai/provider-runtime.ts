import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'

import { getProviderApiKey } from './credentials.ts'
import { parseModelRef } from './models.ts'

export const createLanguageModel = (modelRef: string) => {
  const { provider, modelId } = parseModelRef(modelRef)
  const apiKey = getProviderApiKey(provider)

  if (!apiKey) {
    throw Object.assign(new Error(`No API key configured for ${provider}.`), {
      apiError: {
        code: 'missing_api_key',
        error: `No API key configured for ${provider}.`,
      },
    })
  }

  switch (provider) {
    case 'openai':
      return { model: createOpenAI({ apiKey })(modelId), provider, modelId }
    case 'anthropic':
      return { model: createAnthropic({ apiKey })(modelId), provider, modelId }
    case 'google':
      return { model: createGoogleGenerativeAI({ apiKey })(modelId), provider, modelId }
    case 'openrouter':
      return {
        model: createOpenAI({
          apiKey,
          baseURL: 'https://openrouter.ai/api/v1',
          headers: {
            'HTTP-Referer': 'https://github.com/williamcr01/ark',
            'X-Title': 'Ark',
          },
        })(modelId),
        provider,
        modelId,
      }
    default:
      throw new Error(`Unsupported provider: ${String(provider)}`)
  }
}
