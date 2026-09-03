import { useCallback, useState } from 'react'

import { REASONING_EFFORT_LABELS, type ReasoningEffort } from '@ark/contracts'

import type { AvailableModel } from '@/hooks/useAvailableModels'
import { useShellStore } from '@/state/shell-store.ts'

export type { ReasoningEffort }

export function formatReasoningEffortLabel(effort: ReasoningEffort) {
  return REASONING_EFFORT_LABELS[effort] ?? effort
}

export function resolveEffortForModel(
  model: AvailableModel | undefined,
  storedByModel: Record<string, ReasoningEffort>,
): ReasoningEffort | undefined {
  const supported = model?.reasoningEfforts ?? []
  if (!model || supported.length === 0) {
    return undefined
  }

  const preferred = storedByModel[model.id]
  if (preferred && supported.includes(preferred)) {
    return preferred
  }

  if (model.defaultReasoningEffort && supported.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort
  }

  return supported[0]
}

export function useReasoningEffort(selectedModel: string, models: AvailableModel[]) {
  useState(() => {
    useShellStore.getState().syncFromDesktopSettings()
    return true
  })
  const effortByModel = useShellStore((state) => state.reasoningEffortByModel)

  const getReasoningEffort = useCallback(
    (modelId: string) =>
      resolveEffortForModel(
        models.find((model) => model.id === modelId),
        effortByModel,
      ),
    [effortByModel, models],
  )
  const reasoningEffort = getReasoningEffort(selectedModel)

  const setReasoningEffort = useCallback(
    (effort: ReasoningEffort, modelId = selectedModel) => {
      if (!modelId) {
        return
      }

      const next = { ...useShellStore.getState().reasoningEffortByModel, [modelId]: effort }
      useShellStore.getState().setReasoningEffortByModel(next)
    },
    [selectedModel],
  )

  return { getReasoningEffort, reasoningEffort, setReasoningEffort }
}
