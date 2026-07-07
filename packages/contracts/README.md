# API contracts

`shared/api/` is Ark's **contract boundary** between the React shell (`src/`) and the Express API (`server/`). Both sides import request/response schemas and types from the public entry point:

```ts
import { deckResponseSchema, parseRequestBody } from '../../shared/api/index.ts'
```

Do not import individual files such as `shared/api/decks.ts` from application code — only modules inside `shared/api/` may import each other directly.

The contracts layer depends on **Zod** and portable shared helpers only. It must not import React, Express, Node built-ins, or browser APIs.

## Covered endpoints

| Area           | Routes                                                                                                      | Contract modules         |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------ |
| Health         | `GET /api/health`, `GET /api/models`                                                                        | `health.ts`, `common.ts` |
| Decks          | `GET/POST /api/decks`, `GET/PUT/PATCH/DELETE /api/decks/:id`, `POST /api/decks/:id/patch`                   | `decks.ts`               |
| Versions       | `GET /api/decks/:id/versions`, `GET .../versions/:versionId`, `POST .../rollback`                           | `decks.ts`               |
| Chat           | `GET/POST/DELETE /api/decks/:id/chat`, `POST .../chat/messages`                                             | `chat.ts`                |
| Assets         | `POST/GET /api/decks/:id/assets`, `GET/DELETE /api/decks/:deckId/assets/:assetId`                           | `assets.ts`              |
| Generation     | `POST/GET /api/generation-jobs/:id`, `POST .../cancel`, `POST .../retry` (includes `assetIds` on job start) | `generation-jobs.ts`     |
| Preview        | `POST /api/preview-sessions`, `GET /api/preview-sessions/:token`                                            | `preview.ts`             |
| Runtime errors | `POST /api/runtime-errors`                                                                                  | `runtime-errors.ts`      |

Shared client helpers (`fetchApiJsonOrThrow`, `parseRequestBody`, `assertApiContract`) live in `fetch.ts` and `common.ts` and are re-exported from `index.ts`.

## OpenAPI

`shared/api/openapi-registry.ts` registers every route above against the Zod contracts. `pnpm openapi:generate` writes `openapi/ark.openapi.json`; CI runs `pnpm openapi:check` to prevent drift. Generation job `assetIds` appear on `POST /api/generation-jobs` only — poll responses use `generationJobApiSchema`, which omits request-only fields.

## Contract tests

Route behavior is checked against these schemas in three layers:

| Layer                 | Location                                           | Purpose                                                       |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Schema fixtures       | `shared/api/contracts.test.ts`                     | Parses representative request/response examples through Zod   |
| OpenAPI freshness     | `shared/api/openapi.test.ts`, `pnpm openapi:check` | Generated spec matches committed `openapi/ark.openapi.json`   |
| HTTP drift prevention | `server/api-contract.test.ts`                      | Live Express routes return payloads that match shared schemas |

`assertApiContract(schema, payload)` in `fetch.ts` is the shared assertion helper. It throws with Zod issue messages when a response drifts from the contract.

### Updating contracts when endpoints change

1. **Change the Zod schema** in the appropriate `shared/api/*.ts` module (and export it from `index.ts` if it is new).
2. **Register the route** in `shared/api/openapi-registry.ts` when the HTTP surface changes.
3. **Regenerate OpenAPI** — run `pnpm openapi:generate` and commit `openapi/ark.openapi.json`.
4. **Update route tests** — extend `server/api-contract.test.ts` (or a focused route test such as `server/routes/assets.test.ts`) with a success or validation-error case that calls `assertApiContract` against the new or changed schema.
5. **Run** `pnpm test` and `pnpm openapi:check` locally before pushing.

Request validation failures should assert `simpleErrorResponseSchema`, `apiErrorPayloadSchema`, or a domain-specific error schema (for example `deckValidationErrorResponseSchema`) depending on what the route returns.

## Related docs

- [architecture-boundaries.md](../docs/architecture-boundaries.md) — layer import rules
- [AGENTS.md](../AGENTS.md) — contributor guide
