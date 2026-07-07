import { describe, expect, it } from 'vitest'

import { createLogger, type StructuredLogEntry } from './logger.ts'
import { logTimedEvent, measureAsync, measureSync } from './timing.ts'

describe('observability timing helpers', () => {
  it('measures synchronous work', () => {
    const { result, durationMs } = measureSync(() => 42)

    expect(result).toBe(42)
    expect(durationMs).toBeGreaterThanOrEqual(0)
  })

  it('measures asynchronous work', async () => {
    const { result, durationMs } = await measureAsync(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return 'done'
    })

    expect(result).toBe('done')
    expect(durationMs).toBeGreaterThanOrEqual(0)
  })

  it('logs timed events with durationMs', () => {
    const entries: StructuredLogEntry[] = []
    const logger = createLogger({
      write: (entry) => entries.push(entry),
    })

    logTimedEvent(logger, 'deck.parse.completed', 17, {
      slideCount: 3,
      htmlBytes: 1024,
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      event: 'deck.parse.completed',
      durationMs: 17,
      fields: {
        slideCount: 3,
        htmlBytes: 1024,
      },
    })
  })
})
