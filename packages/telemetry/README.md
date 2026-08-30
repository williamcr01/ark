# @ark/telemetry

**One job:** structured logging, secret redaction, request correlation, and timing.

Layer 0. Imports nothing from other workspace packages. Server-only (`node:crypto`).

| Module          | Responsibility                                                  |
| --------------- | --------------------------------------------------------------- |
| `logger.ts`     | Structured log entries, redacted on the way out                 |
| `redact.ts`     | Secret/HTML redaction and summarisation for log and error text  |
| `request-id.ts` | Request id generation, validation, and response-body attachment |
| `timing.ts`     | `measureSync` / `measureAsync` / `logTimedEvent`                |

Transport-specific glue does not live here: the Express middleware that binds a request id and
logger to a request is `apps/api/observability/middleware.ts`.
