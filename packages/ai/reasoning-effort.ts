import { z } from 'zod'

/**
 * Reasoning / thinking effort levels across providers.
 * Exact supported values are model-specific and advertised on ModelInfo.reasoningEfforts.
 */
export const reasoningEffortSchema = z.enum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}
