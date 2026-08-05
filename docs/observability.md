# Backend observability

Ark emits structured JSON logs from its embedded API and generation runner. Use them to profile deck parsing, validation, preview sessions, and generation jobs inside the desktop process.

## Log shape

Each line is a single JSON object:

```json
{
  "timestamp": "2026-07-07T12:00:00.000Z",
  "level": "info",
  "service": "ark-api",
  "event": "deck.validation.completed",
  "requestId": "…",
  "deckId": null,
  "jobId": null,
  "durationMs": 12,
  "statusCode": null,
  "errorCategory": null,
  "fields": { "valid": true, "issueCount": 0, "htmlBytes": 4096 }
}
```

| Field        | Meaning                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| `service`    | `ark-api` (HTTP + deck routes), `ark-generation` (job runner), or per-request middleware default.              |
| `event`      | Stable event name (see tables below).                                                                          |
| `requestId`  | From `X-Request-Id` header or auto-generated; echoed on JSON responses.                                        |
| `durationMs` | Elapsed time for the operation when applicable.                                                                |
| `fields`     | Event-specific metadata (HTML sizes and counts are not full content — see `apps/api/observability/redact.ts`). |

## HTTP requests

Every API request logs once on response finish:

| Event                    | Level               | Key `fields`                                 |
| ------------------------ | ------------------- | -------------------------------------------- |
| `http.request.completed` | info / warn / error | `method`, `path`, `statusCode`, `durationMs` |

## Deck parsing

Emitted when `parseDeckHtml` runs with a request- or job-scoped logger (API saves, agent `parse_deck` tool during generation).

| Event                  | Level | Key `fields`                                                                      |
| ---------------------- | ----- | --------------------------------------------------------------------------------- |
| `deck.parse.completed` | debug | `durationMs`, `htmlBytes`, `slideCount`, `structure`, `scriptCount`, `assetCount` |

**Profiling tip:** Compare `durationMs` / `htmlBytes` across uploads. Rising p95 with linear HTML size suggests DOM parse cost; flat duration with high `slideCount` suggests per-slide work.

## Deck validation

Emitted when `validateDeckHtmlOnServer` runs with a logger (deck create/update, agent writes, generation finalize).

| Event                       | Level | Key `fields`                                                   |
| --------------------------- | ----- | -------------------------------------------------------------- |
| `deck.validation.completed` | debug | `durationMs`, `htmlBytes`, `valid`, `issueCount`               |
| `deck.validation.failed`    | warn  | `issueCount`, `primaryCode`, `statusCode` (HTTP 400 responses) |

## Preview sessions

| Event                     | Level | Key `fields`                                                                                              |
| ------------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `preview.session.created` | debug | `durationMs`, `htmlBytes`, `editorBridge`                                                                 |
| `preview.session.evicted` | warn  | `reason` (`max_sessions` or `max_total_html_bytes`), `tokenHash`, `htmlBytes`, `sessionCount`, store caps |

Preview session creation is usually cheap (in-memory token + HTML store). Large `htmlBytes` with high `durationMs` may indicate upstream validation or client payload cost. `preview.session.evicted` means the store hit its memory caps and dropped the least-recently-accessed live session(s). `tokenHash` is a short SHA-256 prefix for correlation only; full preview tokens are capability secrets and are never logged.

## Thumbnails

| Event                        | Level | Key `fields`                                   |
| ---------------------------- | ----- | ---------------------------------------------- |
| `thumbnail.status`           | info  | `documentRevision`, `status`, `slideCount`     |
| `thumbnail.render.succeeded` | info  | `documentRevision`, `slideCount`, `durationMs` |
| `thumbnail.render.failed`    | warn  | `documentRevision`, `error`, `durationMs`      |
| `thumbnail.queue.saturated`  | warn  | `documentRevision`, `queued`                   |
| `thumbnail.queue.failed`     | warn  | `documentRevision`, `error`                    |

See [thumbnails.md](./thumbnails.md) for the renderer pipeline and cache identity.

## Generation jobs

| Event                      | Level | Key `fields`                                                 |
| -------------------------- | ----- | ------------------------------------------------------------ |
| `generation.job.started`   | info  | `model`, `provider`, `status`                                |
| `generation.job.step`      | debug | `stepCount`, `latestStepType`, `latestToolName`, `elapsedMs` |
| `generation.job.succeeded` | info  | `durationMs`, `stepCount`                                    |
| `generation.job.failed`    | warn  | `durationMs`, `errorCategory`, `stepCount`                   |
| `generation.job.canceled`  | info  | `durationMs`                                                 |

Job records also persist `observability` on the generation job resource:

- `observability.durationMs` — wall time for the full job.
- `observability.providerMetrics` — model latency, token usage, finish reason (from the agent loop).
- `observability.requestId` — ties logs to the `POST /api/generation-jobs` request.

Poll `GET /api/generation-jobs/:id` to read terminal observability without log access.

## Asset proxy

| Event               | Level       | Key `fields`                                                                   |
| ------------------- | ----------- | ------------------------------------------------------------------------------ |
| `asset.proxy.fetch` | info / warn | `url` (redacted host/path policy), `durationMs`, `statusCode`, `errorCategory` |

## Request correlation

1. Client sends optional `X-Request-Id` (UUID v4).
2. Middleware attaches `requestId` to the request logger and response header/body.
3. Generation jobs copy `requestId` into `job.observability.requestId`.
4. Search logs by `requestId` to connect HTTP handling, deck validation, and job completion.

## Local inspection

With `pnpm dev`, logs print to the API process stdout. Filter examples:

```bash
# Slow deck validation (>50ms)
pnpm dev 2>&1 | jq 'select(.event=="deck.validation.completed" and .durationMs > 50)'

# Generation job steps
pnpm dev 2>&1 | jq 'select(.event=="generation.job.step")'
```

For extraction decisions, aggregate `durationMs` by `event` and bucket by `htmlBytes` or `slideCount` over representative workloads — not single requests.
