# OpenAPI schema

Ark keeps a generated [OpenAPI 3.0.3](https://swagger.io/specification/) document at [`openapi/ark.openapi.json`](../openapi/ark.openapi.json). It documents and validates the private loopback contract between the Electron renderer and Ark's embedded API. The API is not a separately deployed product surface.

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

## Using the schema

Use the committed file for contract tests, documentation, or generated test fixtures. Electron chooses the API port dynamically in packaged builds, so the server entry is illustrative rather than a stable endpoint for external clients.

**Generation jobs** are asynchronous: `POST /api/generation-jobs` returns `202` with a job id; poll `GET /api/generation-jobs/{id}` until `status` is terminal (`succeeded`, `failed`, or `canceled`). Optional `assetIds` on the start request require a `deckId`.

**Preview sessions** are short-lived: `POST /api/preview-sessions` returns a token consumed by the sandbox host at `GET /api/preview-sessions/{token}`.

### Validate responses in tests

Load `openapi/ark.openapi.json` in an OpenAPI test harness or validate focused fixtures to catch drift early. Ark's own CI enforces freshness and route tests validate the live embedded API.

## Related docs

- [packages/contracts/README.md](../packages/contracts/README.md) — covered routes and contract tests
- [runtimes.md](./runtimes.md) — approved `/api/runtimes/...` assets and registry semantics
