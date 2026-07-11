import type { StructuredLogEntry } from '../../apps/api/observability/logger.ts'

type ConsoleMethod = 'log' | 'warn' | 'error'

export type ObservabilityCapture = {
  entries: StructuredLogEntry[]
  stop: () => void
  find: (event: string) => StructuredLogEntry[]
  first: (event: string) => StructuredLogEntry | null
  clear: () => void
}

function tryParseStructuredLog(value: unknown): StructuredLogEntry | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed.startsWith('{') || !trimmed.includes('"event"')) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<StructuredLogEntry>

    if (typeof parsed.event !== 'string' || typeof parsed.timestamp !== 'string') {
      return null
    }

    return parsed as StructuredLogEntry
  } catch {
    return null
  }
}

/**
 * Capture structured Ark API JSON logs written to console while an in-process
 * smoke/benchmark stack is running. Does not change production telemetry.
 */
export function startObservabilityCapture(): ObservabilityCapture {
  const entries: StructuredLogEntry[] = []
  const originals: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {}

  const wrap = (method: ConsoleMethod) => {
    const original = console[method].bind(console)
    originals[method] = original

    console[method] = (...args: unknown[]) => {
      for (const arg of args) {
        const entry = tryParseStructuredLog(arg)

        if (entry) {
          entries.push(entry)
        }
      }

      original(...args)
    }
  }

  wrap('log')
  wrap('warn')
  wrap('error')

  return {
    entries,
    clear() {
      entries.length = 0
    },
    find(event) {
      return entries.filter((entry) => entry.event === event)
    },
    first(event) {
      return entries.find((entry) => entry.event === event) ?? null
    },
    stop() {
      for (const method of ['log', 'warn', 'error'] as const) {
        const original = originals[method]

        if (original) {
          console[method] = original as typeof console.log
        }
      }
    },
  }
}
