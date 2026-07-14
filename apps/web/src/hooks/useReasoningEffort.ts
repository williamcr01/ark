import { useCallback, useState } from 'react'

import type { ReasoningEffort } from '@ark/contracts'

export type { ReasoningEffort }

export const REASONING_EFFORT_LEVELS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
]

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium'

const REASONING_EFFORT_STORAGE_KEY = 'ark:reasoning-effort'

const isReasoningEffort = (value: string | null): value is ReasoningEffort =>
  value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'

const readStoredEffort = (): ReasoningEffort => {
  try {
    const stored = localStorage.getItem(REASONING_EFFORT_STORAGE_KEY)
    return isReasoningEffort(stored) ? stored : DEFAULT_REASONING_EFFORT
  } catch {
    return DEFAULT_REASONING_EFFORT
  }
}

const writeStoredEffort = (effort: ReasoningEffort) => {
  try {
    localStorage.setItem(REASONING_EFFORT_STORAGE_KEY, effort)
  } catch {
    // Ignore storage failures.
  }
}

export function formatReasoningEffortLabel(effort: ReasoningEffort) {
  return REASONING_EFFORT_LEVELS.find((level) => level.value === effort)?.label ?? effort
}

export function useReasoningEffort() {
  const [reasoningEffort, setReasoningEffortState] = useState<ReasoningEffort>(readStoredEffort)

  const setReasoningEffort = useCallback((effort: ReasoningEffort) => {
    setReasoningEffortState(effort)
    writeStoredEffort(effort)
  }, [])

  return { reasoningEffort, setReasoningEffort }
}
