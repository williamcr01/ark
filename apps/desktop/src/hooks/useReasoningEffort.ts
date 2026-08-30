import { useCallback, useState } from 'react'

import { REASONING_EFFORT_LABELS, type ReasoningEffort } from '@ark/contracts'

import type { AvailableModel } from '@/hooks/useAvailableModels'
import { getDesktopSettings, updateDesktopSettings } from '@/lib/ui/desktop-settings'

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
  const [effortByModel, setEffortByModel] = useState<Record<string, ReasoningEffort>>(
    () => getDesktopSettings().reasoningEffortByModel,
  )

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

      const next = { ...effortByModel, [modelId]: effort }
      setEffortByModel(next)
      void updateDesktopSettings({ reasoningEffortByModel: next })
    },
    [effortByModel, selectedModel],
  )

  return { getReasoningEffort, reasoningEffort, setReasoningEffort }
}
