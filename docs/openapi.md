# OpenAPI schema

Ark publishes a generated [OpenAPI 3.0.3](https://swagger.io/specification/) document at [`openapi/ark.openapi.json`](../openapi/ark.openapi.json). Use it to build or validate HTTP clients in languages other than TypeScript, or to document the wire format for a future extracted service.

## Source of truth

**Zod schemas in [`packages/contracts/`](../packages/contracts/) are canonical.** The OpenAPI file is generated from those schemas and checked in CI so it cannot drift silently.

| Artifact                                 | Role                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `packages/contracts/*.ts`                | Request/response validation, TypeScript types, route registration |
| `packages/contracts/openapi-registry.ts` | Maps Zod schemas to OpenAPI paths                                 |
| `openapi/ark.openapi.json`               | Committed generated spec for cross-language tooling               |

When you change an HTTP surface:

1. Update the Zod schema in `packages/contracts/`.
2. Register the route in `openapi-registry.ts` if needed.
3. Run `pnpm openapi:generate` and commit `openapi/ark.openapi.json`.
4. Extend `apps/api/api-contract.test.ts` (or a focused route test) so live responses still match the schema.

See [`packages/contracts/README.md`](../packages/contracts/README.md) for the endpoint list and contract-test workflow.

## Regenerate locally

```bash
pnpm openapi:generate   # write openapi/ark.openapi.json
pnpm openapi:check      # fail if the committed file is stale (same as CI)
```

## Using the schema from another language

You do not need the TypeScript monorepo to call the API. Point your generator or client at the committed JSON file (or fetch it from your deployment’s docs URL once published).

### Generate a typed client

Popular options:

- **[OpenAPI Generator](https://openapi-generator.tech/)** — `openapi-generator-cli generate -i openapi/ark.openapi.json -g python -o clients/python`
- **[openapi-typescript](https://github.com/drwpow/openapi-typescript)** — TypeScript types only (useful outside this repo)
- **[Kiota](https://learn.microsoft.com/en-us/openapi/kiota/)**, **Fern**, **Speakeasy**, etc.

Pick a generator that supports OpenAPI 3.0 and your target language. Regenerate when `ark.openapi.json` changes.

### Hand-written HTTP client

1. Read path, method, query, and body shapes from the spec.
2. Send JSON with `Content-Type: application/json` for mutating routes.
3. Parse JSON responses using the documented status codes and schemas.
4. For binary routes (`GET /api/decks/{deckId}/assets/{assetId}`, `GET /api/runtimes/{runtimeId}/{version}/{assetPath}`, `GET /api/deck-assets`), read the response body as bytes and honor `Content-Type`.

**Generation jobs** are asynchronous: `POST /api/generation-jobs` returns `202` with a job id; poll `GET /api/generation-jobs/{id}` until `status` is terminal (`succeeded`, `failed`, or `canceled`). Optional `assetIds` on the start request require a `deckId`.

**Preview sessions** are short-lived: `POST /api/preview-sessions` returns a token consumed by the sandbox host at `GET /api/preview-sessions/{token}`.

### Validate responses in tests

Load `openapi/ark.openapi.json` in your language’s OpenAPI test harness (e.g. Dredd, Schemathesis, or contract tests against example fixtures) to catch drift early. Ark’s own CI enforces freshness of the generated file; your service should still integration-test against a running API.

## Related docs

- [packages/contracts/README.md](../packages/contracts/README.md) — covered routes and contract tests
- [backend-extraction.md](./backend-extraction.md) — when to split services and how OpenAPI fits that path
- [runtimes.md](./runtimes.md) — approved `/api/runtimes/...` assets and registry semantics
