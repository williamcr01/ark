import { describe, expect, it } from 'vitest'

import { useModelsStore } from './models-store.ts'

const luna = {
  id: 'openai:gpt-5.6-luna',
  provider: 'openai' as const,
  modelId: 'gpt-5.6-luna',
  name: 'GPT-5.6 Luna',
  available: true,
  supportsAttachments: true,
}

describe('useModelsStore', () => {
  it('applyCatalog replaces models and clears the error', () => {
    useModelsStore.getState().reset()
    useModelsStore.getState().setError('stale')
    useModelsStore.getState().applyCatalog({
      models: [luna],
      defaultModel: luna.id,
      warnings: ['slow'],
      apiKeyStatus: 'valid',
    })

    const state = useModelsStore.getState()
    expect(state.models).toEqual([luna])
    expect(state.defaultModel).toBe(luna.id)
    expect(state.warnings).toEqual(['slow'])
    expect(state.apiKeyStatus).toBe('valid')
    expect(state.error).toBe('')
  })

  it('clearCatalog drops models on load failure', () => {
    useModelsStore.getState().reset()
    useModelsStore.getState().applyCatalog({
      models: [luna],
      defaultModel: luna.id,
      apiKeyStatus: 'valid',
    })
    useModelsStore.getState().clearCatalog('Could not load available models.', 'invalid')

    const state = useModelsStore.getState()
    expect(state.models).toEqual([])
    expect(state.defaultModel).toBeNull()
    expect(state.error).toBe('Could not load available models.')
    expect(state.apiKeyStatus).toBe('invalid')
  })

  it('setLoading accepts a functional update', () => {
    useModelsStore.getState().reset()
    expect(useModelsStore.getState().isLoading).toBe(true)
    useModelsStore.getState().setLoading(false)
    useModelsStore.getState().setLoading((current) => !current)
    expect(useModelsStore.getState().isLoading).toBe(true)
  })
})
