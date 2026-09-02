import { lazy, Suspense } from 'react'

import type { ResolvedAppearance } from '@/hooks/useAppearance'
import { getAgentPresenceState } from '@/lib/chat/agent-presence'
import type { AgentStep } from '@ark/chat/messages.ts'
import type { GenerationJobStatus } from '@ark/chat/generation-job.ts'

const ThinkingOrb = lazy(() =>
  import('thinking-orbs').then((module) => ({ default: module.ThinkingOrb })),
)

export type AgentPresenceProps = {
  activeSteps: AgentStep[]
  generationStatus: GenerationJobStatus | null
  reducedMotion: boolean
  resolvedAppearance: ResolvedAppearance
}

const ACTIVE_STATUSES = new Set<GenerationJobStatus>(['queued', 'running', 'canceling'])

export function AgentPresence({
  activeSteps,
  generationStatus,
  reducedMotion,
  resolvedAppearance,
}: AgentPresenceProps) {
  if (!generationStatus || !ACTIVE_STATUSES.has(generationStatus)) return null
  const state = getAgentPresenceState(activeSteps, generationStatus)
  const label = state[0].toUpperCase() + state.slice(1)

  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">
      {reducedMotion ? (
        <span aria-hidden className="size-2 rounded-full bg-[var(--ark-focus)]" />
      ) : (
        <Suspense
          fallback={<span aria-hidden className="size-2 rounded-full bg-[var(--ark-focus)]" />}
        >
          <ThinkingOrb
            aria-label={`Agent ${state}`}
            size={20}
            state={state}
            theme={resolvedAppearance}
          />
        </Suspense>
      )}
      <span>{label}</span>
    </span>
  )
}
