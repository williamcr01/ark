export { createLogger } from '@ark/telemetry/logger.ts'
export type { Logger, StructuredLogEntry } from '@ark/telemetry/logger.ts'
export {
  attachRequestIdToJsonBody,
  createRequestId,
  isValidRequestId,
  REQUEST_ID_HEADER,
  resolveRequestId,
} from '@ark/telemetry/request-id.ts'
export {
  redactForLogging,
  redactHtml,
  redactSecrets,
  sanitizeRuntimeErrorText,
  summarizeHtml,
} from '@ark/telemetry/redact.ts'
export { createRuntimeErrorStore, parseRuntimeErrorBody } from './runtime-errors.ts'
export type {
  RuntimeErrorInput,
  RuntimeErrorRecord,
  RuntimeErrorSeverity,
  RuntimeErrorStore,
} from './runtime-errors.ts'
export { createObservabilityMiddleware, getRequestId, getRequestLogger } from './middleware.ts'
export { logTimedEvent, measureAsync, measureSync } from '@ark/telemetry/timing.ts'
export type { TimedResult } from '@ark/telemetry/timing.ts'
