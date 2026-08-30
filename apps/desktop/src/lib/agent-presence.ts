import type { AgentStep } from '@ark/chat/chat.ts'
import type { GenerationJobStatus } from '@ark/chat/generation-job.ts'

export type AgentPresenceState =
  'listening' | 'solving' | 'searching' | 'shaping' | 'composing' | 'working'

export function getAgentPresenceState(
  activeSteps: AgentStep[],
  generationStatus: GenerationJobStatus | null,
): AgentPresenceState {
  if (generationStatus === 'queued' || activeSteps.length === 0) return 'listening'
  if (generationStatus === 'canceling') return 'working'

  const step = activeSteps.at(-1)
  if (step?.type === 'thinking') return 'solving'
  if (step?.type === 'text') return 'composing'
  if (step?.type === 'tool-call' || step?.type === 'tool-result') {
    const tool = step.toolName ?? ''
    if (/^(read|list|parse)(_|$)/.test(tool)) return 'searching'
    if (/^(patch|edit|write)(_|$)/.test(tool)) return 'shaping'
  }
  return 'working'
}
