# Backend extraction criteria

Ark's backend is TypeScript today: an Express API, an in-process generation job runner, deck parsing/validation, preview sessions, and optional Postgres persistence. This note defines **when** moving a component to another language or a separate service is justified, which areas should stay TypeScript by default, and how future API contracts support that path.

Related issues: [#134](https://github.com/williamcr01/ark/issues/134) (OpenAPI), [#137](https://github.com/williamcr01/ark/issues/137) (generation job runner boundary), [#138](https://github.com/williamcr01/ark/issues/138) (this document).

**Default assumption:** keep API orchestration, agent tool loop, deck editing logic, runtime registry, and preview contracts in TypeScript unless profiling or deployment constraints prove otherwise. This issue does **not** commit to a rewrite.

## Decision criteria

Use these criteria together — no single metric should trigger extraction on its own.

| Criterion                    | Extract when…                                                                                                                                                           | Stay in TypeScript when…                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Performance**              | Profiling shows a hot path dominates p95/p99 latency or CPU at realistic deck sizes and concurrency, and the bottleneck is compute-bound (not I/O or provider latency). | Work is dominated by LLM calls, network I/O, or small HTML documents; gains are marginal after algorithmic fixes.                      |
| **Deployment complexity**    | A separate binary or service simplifies scaling (e.g. horizontal workers, GPU nodes) without forking the whole API.                                                     | Extraction adds another deployable, health check, and release train for little gain.                                                   |
| **Operational cost**         | Running specialized workers is cheaper than over-provisioning the API process (e.g. export/ffmpeg at scale).                                                            | The API process already handles the load; a second fleet increases baseline cost.                                                      |
| **Library support**          | A mature ecosystem in another language clearly wins (e.g. native PDF/video pipelines, WASM compilers).                                                                  | `jsdom`, the Vercel AI SDK, Zod contracts, and shared deck logic already cover the need.                                               |
| **Team velocity**            | A bounded service with a stable HTTP contract can be owned independently without duplicating deck semantics.                                                            | Changes would require keeping two implementations of the same HTML/CSS/JS rules in sync.                                               |
| **Deck model compatibility** | The component treats decks as opaque bytes or a stable parsed schema; it does not need to evolve with agent tools or client preview modes.                              | The component must share exact parsing, validation, editable-element, bridge, and runtime-registry semantics with the shell and agent. |

## Candidate areas to evaluate

These are **candidates for measurement**, not a migration backlog.

| Area                                          | Why it might move                                                                                 | Signals to watch                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Deck parsing & validation                     | `jsdom` DOM walks on large decks can be CPU-heavy.                                                | `deck.parse.completed` / `deck.validation.completed` duration vs `htmlBytes` and `slideCount` (see [observability.md](./observability.md)). |
| Preview safety checks                         | CSP injection, URL scanning, and script stripping may grow.                                       | Preview session creation latency; validation issue rates on upload/save.                                                                    |
| Thumbnail / screenshot / PDF / video / export | Browser or native rendering pipelines often fit a worker fleet.                                   | Export queue depth, job duration, failure rate — not yet implemented.                                                                       |
| Long-running generation workers               | Provider calls already dominate; extraction helps **isolation and scaling**, not raw model speed. | Generation job queue wait time, API process memory during concurrent jobs ([#137](https://github.com/williamcr01/ark/issues/137)).          |
| Storage, indexing, search                     | Full-text search across many decks may outgrow JSON files or simple Postgres queries.             | Deck list latency, search feature requirements, index size.                                                                                 |

## Keep in TypeScript by default

These components share semantics with the React shell, `shared/` contracts, or agent tools. Extract only with a strong measured case **and** a stable cross-language contract.

| Component                                                                              | Rationale                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTP API orchestration**                                                             | Route validation, auth (future), request IDs, and error shaping are tightly coupled to Zod schemas in `shared/api/`.                                             |
| **Agent tool loop** (`server/deck-agent.ts`, `server/deck-tools.ts`)                   | Tools call parsing, patching, and validation in-process; duplicating slide patch semantics elsewhere is high-risk.                                               |
| **Deck patch & element edit** (`server/deck-patch.ts`, element patch API)              | Same HTML rules as client manual editing and `shared/deck-editor-bridge.ts`.                                                                                     |
| **Preview bridge contracts** (`shared/deck-bridge.ts`, `shared/deck-editor-bridge.ts`) | Parent ↔ iframe protocol is versioned with the shell; preview mode detection lives in `src/lib/deck-preview.ts`.                                                 |
| **Runtime registry** (`runtimes/`, `/api/runtimes/...`)                                | Approved asset paths and reveal adapter behavior must match client detection.                                                                                    |
| **Chat persistence & generation job API**                                              | Job state, chat replay, and `assetIds` flow through shared types; OpenAPI will describe the wire format ([#134](https://github.com/williamcr01/ark/issues/134)). |
| **Sandbox host** (`server/sandbox-host.ts`)                                            | CSP headers and token lookup are security boundaries tied to preview session shape.                                                                              |

## OpenAPI and non-TypeScript implementations

Issue [#134](https://github.com/williamcr01/ark/issues/134) adds a generated OpenAPI schema for the Ark HTTP API, verified in CI. That schema is the **compatibility layer** for any future non-TypeScript service:

1. **Contract-first boundary** — A worker in Go, Rust, or Python implements the same paths, request bodies, and response shapes as the OpenAPI document (decks, chat, generation jobs, preview sessions, assets, health).
2. **Gradual extraction** — The API process can proxy or enqueue work to an external service while the shell keeps calling the same URLs; only deployment wiring changes.
3. **Shared semantics without shared code** — Parsing rules that must stay identical should be specified as test fixtures (HTML samples in `presentations/` and Vitest fixtures), not re-derived from TypeScript types alone.
4. **Generation jobs** — The runner interface ([#137](https://github.com/williamcr01/ark/issues/137)) is the in-process analogue of an OpenAPI-described `POST /api/generation-jobs` + poll/cancel contract; an external worker would honor the same job record shape.

Until OpenAPI ships, treat `shared/api/*.ts` Zod schemas as the source of truth; after #134, prefer the generated schema for cross-language clients and drift checks.

## Recommended workflow

1. **Measure** — Use structured logs in [observability.md](./observability.md); correlate `durationMs` with `htmlBytes`, `slideCount`, and `requestId`.
2. **Reproduce** — Capture representative decks (large slide counts, heavy scripts, many assets) in fixtures.
3. **Optimize in place** — Algorithmic improvements and caching in TypeScript first (cheaper than a new runtime).
4. **Prototype behind a boundary** — Introduce an internal interface (as with the generation job runner) or a new HTTP resource before deleting in-process code.
5. **Decide** — Score the extraction against the criteria table; document the decision in a short ADR or issue comment.

## Anti-patterns

- Rewriting the API in another language without OpenAPI and fixture-backed parity tests.
- Splitting deck parsing from validation when both must share the same DOM assumptions.
- Moving generation to a worker without preserving job observability (`observability.durationMs`, provider metrics, step progress).
- Treating provider latency as a backend extraction problem — model calls will dominate until deck HTML or tool-step work is proven otherwise.
