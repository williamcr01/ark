import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { AvailableModel } from '@/hooks/useAvailableModels'
import { resolveEffortForModel, useReasoningEffort } from '@/hooks/useReasoningEffort'

const models: AvailableModel[] = [
  {
    id: 'openai:gpt-5.6-luna',
    provider: 'openai',
    modelId: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    available: true,
    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium',
    supportsAttachments: true,
  },
  {
    id: 'google:gemini-3.1-pro-preview',
    provider: 'google',
    modelId: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    available: true,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'high',
    supportsAttachments: true,
  },
  {
    id: 'openai:gpt-5.4-mini',
    provider: 'openai',
    modelId: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    available: true,
    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'none',
    supportsAttachments: true,
  },
  {
    id: 'openai:text-only-fixture',
    provider: 'openai',
    modelId: 'text-only-fixture',
    name: 'Text Only Fixture',
    available: true,
    reasoningEfforts: [],
    supportsAttachments: true,
  },
]

afterEach(() => {
  localStorage.clear()
})

describe('resolveEffortForModel', () => {
  it('prefers stored effort, then clamps invalid values to the model default', () => {
    expect(resolveEffortForModel(models[0], { 'openai:gpt-5.6-luna': 'xhigh' })).toBe('xhigh')
    expect(resolveEffortForModel(models[1], { 'google:gemini-3.1-pro-preview': 'max' })).toBe(
      'high',
    )
    expect(resolveEffortForModel(models[3], {})).toBeUndefined()
  })
})

describe('useReasoningEffort', () => {
  it('stores effort per model and restores it when switching back', () => {
    const { result, rerender } = renderHook(
      ({ selectedModel }) => useReasoningEffort(selectedModel, models),
      { initialProps: { selectedModel: 'openai:gpt-5.6-luna' } },
    )

    expect(result.current.reasoningEffort).toBe('medium')

    act(() => {
      result.current.setReasoningEffort('max')
    })
    expect(result.current.reasoningEffort).toBe('max')

    rerender({ selectedModel: 'google:gemini-3.1-pro-preview' })
    expect(result.current.reasoningEffort).toBe('high')

    rerender({ selectedModel: 'openai:gpt-5.6-luna' })
    expect(result.current.reasoningEffort).toBe('max')

    rerender({ selectedModel: 'openai:text-only-fixture' })
    expect(result.current.reasoningEffort).toBeUndefined()
  })
})
