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
    supportsReasoning: true,
  },
  {
    id: 'google:gemini-3.1-pro-preview',
    provider: 'google',
    modelId: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    available: true,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'high',
    supportsReasoning: true,
  },
  {
    id: 'openai:gpt-5.3-codex-spark',
    provider: 'openai',
    modelId: 'gpt-5.3-codex-spark',
    name: 'Code 5.3 Spark',
    available: true,
    reasoningEfforts: [],
    supportsReasoning: false,
  },
]

afterEach(() => {
  localStorage.clear()
})

describe('resolveEffortForModel', () => {
  it('prefers stored effort, then clamps invalid values to the model default', () => {
    expect(resolveEffortForModel(models[0], { 'openai:gpt-5.6-luna': 'xhigh' }, 'low')).toBe(
      'xhigh',
    )
    expect(resolveEffortForModel(models[1], { 'google:gemini-3.1-pro-preview': 'max' }, null)).toBe(
      'high',
    )
    expect(resolveEffortForModel(models[2], {}, 'high')).toBeUndefined()
  })

  it('migrates a legacy global effort when valid for the model', () => {
    expect(resolveEffortForModel(models[0], {}, 'low')).toBe('low')
    expect(resolveEffortForModel(models[1], {}, 'minimal')).toBe('high')
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

    rerender({ selectedModel: 'openai:gpt-5.3-codex-spark' })
    expect(result.current.reasoningEffort).toBeUndefined()
  })
})
