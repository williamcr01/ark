# Architecture boundaries

Ark is one Electron desktop application split into a trusted main process, an untrusted renderer,
an internal local API, a hostile-deck sandbox origin, and a stack of single-purpose packages.

Each package has one job, and the stack has a direction: a package may import from lower layers
only. Boundary violations fail `pnpm lint`.

## The package stack

| Layer | Package                 | One job                                                        |
| ----- | ----------------------- | -------------------------------------------------------------- |
| 0     | `@ark/runtime-registry` | Which runtime assets are approved, at which pinned version     |
| 0     | `@ark/telemetry`        | Structured logging, redaction, request ids, timing             |
| 1     | `@ark/deck`             | The deck document model: read, patch, validate                 |
| 1     | `@ark/ai`               | Providers, models, credentials, provider options               |
| 2     | `@ark/deck-preview`     | Deck → preview document, and the parent ↔ frame protocol       |
| 2     | `@ark/editor-runtime`   | The manual editor protocol and its injected script             |
| 2     | `@ark/chat`             | The conversation model: messages, steps, jobs, agent protocols |
| 3     | `@ark/storage`          | Persistence: records, stores, the `.ark` workspace file        |
| 4     | `@ark/contracts`        | The local HTTP API's Zod schemas and OpenAPI registry          |
| 5     | `@ark/agent`            | Running a generation: the loop, its tools, the job runner      |
| 5     | `@ark/mcp`              | Exposing Ark's deck tools to external agents over MCP          |

```text
runtime-registry, telemetry
  └► deck, ai
       └► deck-preview, editor-runtime, chat
            └► storage
                 └► contracts
                      └► agent, mcp
                           └► apps/*
```

`@ark/agent` and `@ark/mcp` sit **above** `@ark/contracts`, not below it. A job runner is handed an
HTTP request shape and hands back an HTTP response shape; putting it under contracts would mean
inventing a parallel set of input types for no gain. Nothing in contracts imports either package,
so the order stays acyclic.

## The apps

| Location                | Role                                                | May import from                                     |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `apps/desktop/electron` | Trusted Electron main/preload and process wiring    | `@ark/api`, `@ark/sandbox`, any package, Electron   |
| `apps/desktop/src`      | Sandboxed React renderer                            | browser-safe packages only                          |
| `apps/api`              | The local HTTP API: composition, routes, thumbnails | any package                                         |
| `apps/sandbox`          | Separate-origin hostile deck preview host           | `@ark/storage/stores/preview-sessions.ts`, packages |
| `apps/mcp`              | The stdio MCP server executable (`@ark/mcp-server`) | `@ark/mcp`, packages                                |

The Electron main process is the composition root. It is the only layer allowed to combine the
local API, sandbox host, safe credential storage, updater, and native thumbnail capture.

`apps/api` is HTTP and nothing else: `app.ts` composes, `services.ts` builds the dependency graph,
`routes/` handles requests, `thumbnails/` serves them. The agent loop, persistence, and the deck
model all live in packages.

## Browser-safe vs server-only

Packages are one or the other, and it is enforced:

- **Browser-safe** — no `node:*`, no Express, no React. `runtime-registry`, `telemetry`, `deck`,
  `ai`, `deck-preview`, `editor-runtime`, `chat`, `contracts`. The renderer bundles these.
  Two files opt out by name: `runtime-registry/runtime-stylesheet-disk.ts` and
  `telemetry/request-id.ts`, which needs `node:crypto`.
- **Server-only** — `node:*` allowed, still no Express or React. `storage`, `agent`, `mcp`.
  **The renderer must not import these**, which is a lint rule, not a convention.

Shared vocabulary a lower layer needs is defined in that lower layer and re-exported upward, so a
consumer's import path does not change. `@ark/contracts` re-exports the provider and reasoning
enums from `@ark/ai`, deck ids and titles from `@ark/deck`, and job ids from `@ark/chat`.

## Rules

1. **The renderer must not import Node, Electron, `apps/api`, `apps/sandbox`, or a server-only
   package.** It talks to the local API over HTTP and to native capabilities through the narrow
   preload bridge.
2. **The Electron main process may import the internal apps.** It owns their lifetime, dynamic
   ports, data directory, and shutdown.
3. **`apps/api` and `apps/sandbox` must not import renderer code.** React and DOM UI state stay in
   `apps/desktop/src`.
4. **`packages/*` must not import from `apps/`.**
5. **A package may only import from a lower layer.** Two packages that need each other means one of
   them holds something that belongs further down.

Enforced by `no-restricted-imports` in `eslint.config.js` and `.oxlintrc.json`, and by pnpm, which
refuses a workspace dependency cycle.

## Runtime boundary

Electron starts two servers on dynamically allocated `127.0.0.1` ports. The app origin serves the
renderer and `/api`; the sandbox origin serves processed deck HTML. These are internal origins, not
public deployment surfaces.

The preload bridge exposes only credential, settings, MCP, file-dialog, and update operations. Deck
HTML never receives preload or Node access.
