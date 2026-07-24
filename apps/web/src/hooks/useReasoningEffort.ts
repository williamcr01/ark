import { useCallback, useEffect, useMemo, useState } from 'react'

import { REASONING_EFFORT_LABELS, type ReasoningEffort } from '@ark/contracts'

import type { AvailableModel } from '@/hooks/useAvailableModels'

export type { ReasoningEffort }

const REASONING_EFFORT_STORAGE_KEY = 'ark:reasoning-effort'
const LEGACY_REASONING_EFFORT_BY_MODEL_STORAGE_KEY = 'ark:reasoning-effort-by-model'
const REASONING_EFFORT_BY_MODEL_STORAGE_KEY = 'ark:reasoning-effort-by-model:v1'

const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  value === 'none' ||
  value === 'minimal' ||
  value === 'low' ||
  value === 'medium' ||
  value === 'high' ||
  value === 'xhigh' ||
  value === 'max'

const readLegacyEffort = (): ReasoningEffort | null => {
  try {
    const stored = localStorage.getItem(REASONING_EFFORT_STORAGE_KEY)
    return isReasoningEffort(stored) ? stored : null
  } catch {
    return null
  }
}

const readStoredEffortMap = (): Record<string, ReasoningEffort> => {
  try {
    const raw =
      localStorage.getItem(REASONING_EFFORT_BY_MODEL_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_REASONING_EFFORT_BY_MODEL_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>
    const next: Record<string, ReasoningEffort> = {}

    for (const [modelId, value] of Object.entries(parsed)) {
      if (isReasoningEffort(value)) {
        next[modelId] = value
      }
    }

    return next
  } catch {
    return {}
  }
}

const writeStoredEffortMap = (map: Record<string, ReasoningEffort>) => {
  try {
    localStorage.setItem(REASONING_EFFORT_BY_MODEL_STORAGE_KEY, JSON.stringify(map))
    localStorage.removeItem(LEGACY_REASONING_EFFORT_BY_MODEL_STORAGE_KEY)
  } catch {
    // Ignore storage failures.
  }
}

export function formatReasoningEffortLabel(effort: ReasoningEffort) {
  return REASONING_EFFORT_LABELS[effort] ?? effort
}

export function resolveEffortForModel(
  model: AvailableModel | undefined,
  storedByModel: Record<string, ReasoningEffort>,
  legacyEffort: ReasoningEffort | null = null,
): ReasoningEffort | undefined {
  const supported = model?.reasoningEfforts ?? []
  if (!model || supported.length === 0) {
    return undefined
  }

  const preferred = storedByModel[model.id] ?? legacyEffort
  if (preferred && supported.includes(preferred)) {
    return preferred
  }

  if (model.defaultReasoningEffort && supported.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort
  }

  return supported[0]
}

export function useReasoningEffort(selectedModel: string, models: AvailableModel[]) {
  const [effortByModel, setEffortByModel] =
    useState<Record<string, ReasoningEffort>>(readStoredEffortMap)
  const [legacyEffort] = useState<ReasoningEffort | null>(readLegacyEffort)

  const selectedModelInfo = useMemo(
    () => models.find((model) => model.id === selectedModel),
    [models, selectedModel],
  )

  const reasoningEffort = useMemo(
    () => resolveEffortForModel(selectedModelInfo, effortByModel, legacyEffort),
    [effortByModel, legacyEffort, selectedModelInfo],
  )

  useEffect(() => {
    writeStoredEffortMap(effortByModel)
  }, [effortByModel])

  const setReasoningEffort = useCallback(
    (effort: ReasoningEffort, modelId = selectedModel) => {
      if (!modelId) {
        return
      }

      setEffortByModel((current) => ({ ...current, [modelId]: effort }))
    },
    [selectedModel],
  )

  return { reasoningEffort, setReasoningEffort }
}
