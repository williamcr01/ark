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

## Related docs

- [architecture-boundaries.md](../docs/architecture-boundaries.md) — layer import rules
- [AGENTS.md](../AGENTS.md) — contributor guide
