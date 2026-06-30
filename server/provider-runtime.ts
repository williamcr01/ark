import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'

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
      return { model: openai(modelId), provider, modelId }
    case 'anthropic':
      return { model: anthropic(modelId), provider, modelId }
    case 'google':
      return { model: google(modelId), provider, modelId }
    default:
      throw new Error(`Unsupported provider: ${String(provider)}`)
  }
}
