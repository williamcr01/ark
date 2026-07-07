# Architecture boundaries

Ark splits the codebase into workspace apps and shared packages. Import rules keep the React shell, Express API, sandbox host, and shared libraries decoupled.

## Layers

| Location | Role | May import from |
| --- | --- | --- |
| `apps/web` | React shell (Vite client) | `@ark/contracts`, `@ark/deck-core`, `@ark/runtime-registry` |
| `apps/api` | Express API, agent loop, persistence | workspace packages |
| `apps/sandbox` | Preview sandbox host | `@ark/api/preview-sessions`, workspace packages |
| `packages/contracts` | HTTP API Zod schemas and client helpers | `@ark/deck-core`, `@ark/runtime-registry` |
| `packages/deck-core` | Deck helpers, bridge protocols, validation | `@ark/runtime-registry` |
| `packages/runtime-registry` | Approved runtime manifest and registry helpers | other `packages/runtime-registry` modules only |
| `test/` | Cross-layer HTML fixtures | not part of the app graph (tests/scripts only) |

Neutral directories (`test/`, `scripts/`, `docs/`, `runtimes/`, `data/`) are not import targets for production code except where noted (e.g. `packages/runtime-registry/deck-runtime-registry.ts` reads `runtimes/manifest.json`).

## Rules

1. **`apps/web` must not import from `apps/api`.** The browser talks to the API over HTTP; shared types and helpers live in workspace packages.
2. **`apps/api` must not import from `apps/web`.** Server code must not depend on React components or client-only helpers.
3. **`packages/*` must not import from `apps/`.** Packages are the contract both apps import.
4. **HTTP API contracts live in `packages/contracts/`.** Import from `@ark/contracts` only in application code — not from individual files under `packages/contracts/`. See [packages/contracts/README.md](../packages/contracts/README.md).
5. **Packages must not depend on React, Express, or environment-specific APIs** unless the file name makes the environment explicit (e.g. `packages/runtime-registry/runtime-stylesheet-disk.ts`).

Package dependency direction (no cycles):

```txt
apps/web ──► @ark/contracts, @ark/deck-core, @ark/runtime-registry
apps/api ──► @ark/contracts, @ark/deck-core, @ark/runtime-registry
apps/sandbox ──► @ark/api/preview-sessions, @ark/contracts, @ark/deck-core, @ark/runtime-registry
@ark/contracts ──► @ark/deck-core, @ark/runtime-registry
@ark/deck-core ──► @ark/runtime-registry
```

## Enforcement

Boundary violations fail `pnpm lint` via ESLint `no-restricted-imports` rules in `eslint.config.js`. CI runs the same check on every push and pull request.

## Related docs

- [AGENTS.md](../AGENTS.md) — agent and contributor guide
- [packages/contracts/README.md](../packages/contracts/README.md) — HTTP API contract boundary
