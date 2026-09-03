import type { AgentStep } from '@ark/chat/messages.ts'

const THINKING_PROGRESS_THROTTLE_MS = 200

export function createThinkingProgressReporter(
  accumulatedSteps: AgentStep[],
  onStepProgress?: (steps: AgentStep[]) => void | Promise<void>,
) {
  let thinkingBuffer = ''
  let thinkingStartedAt: number | null = null
  let lastFlushAt = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let pendingFlush: Promise<void> = Promise.resolve()

  const withThinking = () => {
    const steps = [...accumulatedSteps]
    if (thinkingBuffer) {
      steps.push({ type: 'thinking', summary: thinkingBuffer })
    }
    return steps
  }

  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }

    lastFlushAt = Date.now()
    pendingFlush = pendingFlush.then(async () => {
      await onStepProgress?.(withThinking())
    })
    return pendingFlush
  }

  const scheduleFlush = () => {
    const elapsed = Date.now() - lastFlushAt
    if (elapsed >= THINKING_PROGRESS_THROTTLE_MS) {
      void flush()
      return
    }

    if (flushTimer) {
      return
    }

    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, THINKING_PROGRESS_THROTTLE_MS - elapsed)
  }

  return {
    appendDelta(text: string) {
      if (!text) {
        return
      }

      if (thinkingStartedAt === null) {
        thinkingStartedAt = Date.now()
      }
      thinkingBuffer += text
      scheduleFlush()
    },
    /** Finalize in-progress thinking (from deltas or finished-step text) into accumulatedSteps. */
    async commitThinkingStep(fallbackText?: string) {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }

      await pendingFlush

      const summary = (thinkingBuffer || fallbackText || '').trim()
      const startedAt = thinkingStartedAt
      thinkingBuffer = ''
      thinkingStartedAt = null

      if (summary) {
        accumulatedSteps.push({
          type: 'thinking',
          summary,
          durationMs: startedAt !== null ? Math.max(0, Date.now() - startedAt) : 0,
        })
      }
    },
  }
}

export type ThinkingProgressReporter = ReturnType<typeof createThinkingProgressReporter>
