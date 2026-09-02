import { describe, expect, it } from 'vitest'

import {
  isOpenRouterChatToolsModel,
  openRouterModelToCatalogEntry,
  parseOpenRouterModalityString,
  type OpenRouterModelPayload,
} from './openrouter-models.ts'

const model = (
  overrides: Partial<OpenRouterModelPayload> & Pick<OpenRouterModelPayload, 'id'>,
): OpenRouterModelPayload => ({
  name: overrides.id,
  architecture: {
    input_modalities: ['text'],
    output_modalities: ['text'],
  },
  supported_parameters: ['tools'],
  ...overrides,
})

describe('OpenRouter chat/tools filter', () => {
  it('keeps tools-capable text chat models', () => {
    expect(
      isOpenRouterChatToolsModel(
        model({
          id: 'anthropic/claude-3.5-sonnet',
          architecture: {
            modality: 'text+image->text',
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
          },
        }),
      ),
    ).toBe(true)
  })

  it('drops models that cannot call tools', () => {
    expect(
      isOpenRouterChatToolsModel(
        model({
          id: 'openai/gpt-4o-mini',
          supported_parameters: ['temperature', 'max_tokens'],
        }),
      ),
    ).toBe(false)
  })

  it('drops image-to-image, audio-only, and embedding-style rows', () => {
    expect(
      isOpenRouterChatToolsModel(
        model({
          id: 'black-forest-labs/flux',
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
        }),
      ),
    ).toBe(false)
    expect(
      isOpenRouterChatToolsModel(
        model({
          id: 'openai/gpt-4o-audio',
          architecture: { input_modalities: ['audio'], output_modalities: ['audio'] },
        }),
      ),
    ).toBe(false)
    expect(
      isOpenRouterChatToolsModel(
        model({
          id: 'openai/text-embedding-3-large',
          name: 'OpenAI: Text Embedding 3 Large',
        }),
      ),
    ).toBe(false)
  })

  it('parses legacy modality strings', () => {
    expect(parseOpenRouterModalityString('text+image->text')).toEqual({
      input: ['text', 'image'],
      output: ['text'],
    })
  })

  it('sets attachments and a small reasoning set from architecture/parameters', () => {
    const withReasoning = openRouterModelToCatalogEntry(
      model({
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Anthropic: Claude 3.5 Sonnet',
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        supported_parameters: ['tools', 'reasoning'],
      }),
    )
    expect(withReasoning).toMatchObject({
      provider: 'openrouter',
      modelId: 'anthropic/claude-3.5-sonnet',
      supportsAttachments: true,
      reasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium',
      reasoningTransport: 'openai-effort',
    })

    const textOnly = openRouterModelToCatalogEntry(
      model({
        id: 'openai/gpt-4o-mini',
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        supported_parameters: ['tools'],
      }),
    )
    expect(textOnly).toMatchObject({
      supportsAttachments: false,
      reasoningEfforts: [],
      reasoningTransport: 'none',
    })
    expect(textOnly?.defaultReasoningEffort).toBeUndefined()
  })
})
