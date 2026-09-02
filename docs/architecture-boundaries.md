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
| 2     | `@ark/editor-runtime`   | The manual editor protocol and its injected script             |
| 2     | `@ark/chat`             | The conversation model: messages, steps, jobs, agent protocols |
| 2     | `@ark/deck-export`      | Slide → scene model for PowerPoint export                      |
| 2     | `@ark/deck-import`      | PowerPoint (`.pptx`) → Ark HTML deck (server-only)             |
| 3     | `@ark/deck-preview`     | Deck → preview document, and the parent ↔ frame protocol       |
| 4     | `@ark/storage`          | Persistence: records, stores, the `.ark` workspace file        |
| 5     | `@ark/contracts`        | The local HTTP API's Zod schemas and OpenAPI registry          |
| 6     | `@ark/agent`            | Running a generation: the loop, its tools, the job runner      |
| 7     | `@ark/mcp`              | Exposing Ark's deck tools to external agents over MCP          |

```text
runtime-registry, telemetry
  └► deck, ai
       └► editor-runtime, chat, deck-export, deck-import
            └► deck-preview
                 └► storage
                      └► contracts
                           └► agent
                                └► mcp
                                     └► apps/*
```

`@ark/agent` and `@ark/mcp` sit **above** `@ark/contracts`, not below it. A job runner is handed an
HTTP request shape and hands back an HTTP response shape; putting it under contracts would mean
inventing a parallel set of input types for no gain. Nothing in contracts imports either package,
so the order stays acyclic.

`pnpm check:boundaries` (run by `pnpm lint`) enforces this graph: every import must go to a
strictly lower layer, every workspace dependency must be both declared and used, and the root
`tsconfig.json` must reference every project. A declared dependency nothing imports is rejected
too — a phantom edge can make the graph cyclic without any source file being wrong.

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
  `ai`, `editor-runtime`, `deck-export`, `chat`, `deck-preview`, `contracts`. The renderer bundles these.
  Two files opt out by name: `runtime-registry/runtime-stylesheet-disk.ts` and
  `telemetry/request-id.ts`, which needs `node:crypto`.
- **Server-only** — `node:*` allowed, still no Express or React. `storage`, `agent`, `mcp`,
  `deck-import`. **The renderer must not import these**, which is a lint rule, not a convention.

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

Rules 1-4 are enforced by `no-restricted-imports` in `eslint.config.js` and `.oxlintrc.json`.
Rule 5 is enforced by `scripts/check-package-boundaries.mjs`, which ESLint cannot express: it needs
the whole graph, not one file's imports.

## Runtime boundary

Electron starts two servers on dynamically allocated `127.0.0.1` ports. The app origin serves the
renderer and `/api`; the sandbox origin serves processed deck HTML. These are internal origins, not
public deployment surfaces.

The preload bridge exposes only credential, settings, MCP, file-dialog, and update operations. Deck
HTML never receives preload or Node access.

## Structure budgets

These are **warnings** in this phase (inventory for later enforcement). `pnpm lint` reports them
but still exits 0 for budget breaches.

| Budget                               | Limit                                                 | Where                                              |
| ------------------------------------ | ----------------------------------------------------- | -------------------------------------------------- |
| File length                          | 500 lines (`skipBlankLines`, `skipComments`)          | `**/*.{ts,tsx}` except tests (`max-lines`)         |
| Function length                      | 120 lines (`skipBlankLines`, `skipComments`, `IIFEs`) | same (`max-lines-per-function`)                    |
| Exported `*Props`                    | 12 fields                                             | `apps/desktop/src` (`scripts/check-structure.mjs`) |
| `export function use*` return object | 10 keys                                               | `apps/desktop/src` (`scripts/check-structure.mjs`) |

Hooks under `apps/desktop/src/hooks/` must not import `@/components/*` or `../components/*`
(`no-restricted-imports`, currently a warning). `scripts/check-structure.mjs --strict` exits 1
when the Props/hook inventory is non-empty.
