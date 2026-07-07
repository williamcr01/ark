import { redactForLogging } from './redact.ts'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = Record<string, unknown>

export type StructuredLogEntry = {
  timestamp: string
  level: LogLevel
  service: string
  event: string
  requestId?: string | null
  deckId?: string | null
  jobId?: string | null
  durationMs?: number | null
  statusCode?: number | null
  errorCategory?: string | null
  fields?: LogFields
}

export type Logger = {
  log: (level: LogLevel, event: string, fields?: LogFields) => void
  debug: (event: string, fields?: LogFields) => void
  info: (event: string, fields?: LogFields) => void
  warn: (event: string, fields?: LogFields) => void
  error: (event: string, fields?: LogFields) => void
}

export type LoggerOptions = {
  service?: string
  requestId?: string | null
  deckId?: string | null
  jobId?: string | null
  write?: (entry: StructuredLogEntry) => void
}

function defaultWrite(entry: StructuredLogEntry) {
  const line = JSON.stringify(entry)

  if (entry.level === 'error') {
    console.error(line)
    return
  }

  if (entry.level === 'warn') {
    console.warn(line)
    return
  }

  console.log(line)
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const service = options.service ?? 'ark-api'
  const baseContext = {
    requestId: options.requestId ?? null,
    deckId: options.deckId ?? null,
    jobId: options.jobId ?? null,
  }
  const write = options.write ?? defaultWrite

  const log = (level: LogLevel, event: string, fields: LogFields = {}) => {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      event,
      requestId: baseContext.requestId,
      deckId: typeof fields.deckId === 'string' ? fields.deckId : baseContext.deckId,
      jobId: typeof fields.jobId === 'string' ? fields.jobId : baseContext.jobId,
      durationMs: typeof fields.durationMs === 'number' ? fields.durationMs : null,
      statusCode: typeof fields.statusCode === 'number' ? fields.statusCode : null,
      errorCategory: typeof fields.errorCategory === 'string' ? fields.errorCategory : null,
      fields: redactForLogging(fields) as LogFields,
    }

    write(entry)
  }

  return {
    log,
    debug: (event, fields) => log('debug', event, fields),
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
  }
}
