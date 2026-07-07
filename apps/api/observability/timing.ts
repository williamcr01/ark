import type { Logger } from './logger.ts'

export type TimedResult<T> = {
  result: T
  durationMs: number
}

export function measureSync<T>(operation: () => T): TimedResult<T> {
  const startedAt = performance.now()
  const result = operation()
  const durationMs = Math.round(performance.now() - startedAt)

  return { result, durationMs }
}

export async function measureAsync<T>(operation: () => Promise<T>): Promise<TimedResult<T>> {
  const startedAt = performance.now()
  const result = await operation()
  const durationMs = Math.round(performance.now() - startedAt)

  return { result, durationMs }
}

export function logTimedEvent(
  logger: Logger,
  event: string,
  durationMs: number,
  fields: Record<string, unknown> = {},
  level: 'debug' | 'info' | 'warn' = 'debug',
) {
  logger.log(level, event, {
    ...fields,
    durationMs,
  })
}
