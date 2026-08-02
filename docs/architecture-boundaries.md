# Architecture boundaries

Ark is one Electron desktop application split into a trusted main process, an untrusted renderer, an internal local API, a hostile-deck sandbox origin, and shared packages.

## Layers

| Location                    | Role                                               | May import from                                             |
| --------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `apps/desktop/electron`     | Trusted Electron main/preload and process wiring   | `@ark/api`, `@ark/sandbox`, workspace packages, Electron    |
| `apps/desktop/src`          | Sandboxed React renderer                           | `@ark/contracts`, `@ark/deck-core`, `@ark/runtime-registry` |
| `apps/api`                  | Embedded local API, agent loop, filesystem storage | workspace packages                                          |
| `apps/sandbox`              | Separate-origin hostile deck preview host          | `@ark/api/preview-sessions`, workspace packages             |
| `packages/contracts`        | Local HTTP API Zod schemas and renderer helpers    | `@ark/deck-core`, `@ark/runtime-registry`                   |
| `packages/deck-core`        | Deck helpers, bridge protocols, validation         | `@ark/runtime-registry`                                     |
| `packages/runtime-registry` | Approved runtime manifest and registry helpers     | other `packages/runtime-registry` modules only              |

The Electron main process is the composition root. It is the only layer allowed to combine the local API, sandbox host, safe credential storage, updater, and native thumbnail capture.

## Rules

1. **The renderer must not import Node, Electron, `apps/api`, or `apps/sandbox`.** It talks to the local API over HTTP and native capabilities through the narrow preload bridge.
2. **The Electron main process may import the internal apps.** It owns their lifetime, dynamic ports, data directory, and shutdown.
3. **`apps/api` and `apps/sandbox` must not import renderer code.** React and DOM UI state stay in `apps/desktop/src`.
4. **`packages/*` must not import from `apps/`.** Packages remain neutral shared contracts and deck logic.
5. **HTTP contracts live in `packages/contracts/`.** Application code imports them from `@ark/contracts`.

```text
apps/desktop/electron ──► apps/api, apps/sandbox, packages/*
apps/desktop/src ──► @ark/contracts, @ark/deck-core, @ark/runtime-registry
apps/api ──► @ark/contracts, @ark/deck-core, @ark/runtime-registry
apps/sandbox ──► @ark/api/preview-sessions, @ark/deck-core, @ark/runtime-registry
@ark/contracts ──► @ark/deck-core, @ark/runtime-registry
@ark/deck-core ──► @ark/runtime-registry
```

Boundary violations fail `pnpm lint:eslint` through `no-restricted-imports` rules in `eslint.config.js`.

## Runtime boundary

Electron starts two servers on dynamically allocated `127.0.0.1` ports. The app origin serves the renderer and `/api`; the sandbox origin serves processed deck HTML. These are internal origins, not public deployment surfaces.

The preload bridge exposes only credential and update operations. Deck HTML never receives preload or Node access.
