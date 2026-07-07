# Architecture boundaries

Ark splits the codebase into three application layers plus neutral support directories. Import rules keep the React shell, Express API, and shared contracts decoupled so the backend can evolve independently.

## Layers

| Directory | Role                                               | May import from                                |
| --------- | -------------------------------------------------- | ---------------------------------------------- |
| `src/`    | React shell (Vite client)                          | `shared/`                                      |
| `server/` | Express API, agent loop, persistence               | `shared/`                                      |
| `shared/` | Types, validation, bridge protocols, API contracts | other `shared/` modules only                   |
| `test/`   | Cross-layer HTML fixtures and helpers              | not part of the app graph (tests/scripts only) |

Neutral directories (`test/`, `scripts/`, `docs/`, `runtimes/`, `data/`) are not import targets for production code except where noted (e.g. `shared/deck-runtime-registry.ts` reads `runtimes/manifest.json`).

## Rules

1. **`src/` must not import from `server/`.** The browser talks to the API over HTTP; shared types and helpers live in `shared/`.
2. **`server/` must not import from `src/`.** Server code must not depend on React components or client-only helpers.
3. **`shared/` must not import from `src/` or `server/`.** Shared modules are the contract both sides import.
4. **`shared/` must not depend on React, Express, or environment-specific APIs** unless the file name makes the environment explicit (e.g. `shared/runtime-stylesheet-disk.ts` for Node disk reads). Browser-only DOM usage belongs in `src/`; server adapters (e.g. `server/deck-validate.ts` wrapping `shared/deck-validate.ts` with JSDOM) belong in `server/`.

## Enforcement

Boundary violations fail `pnpm lint` via ESLint `no-restricted-imports` rules in `eslint.config.js`. CI runs the same check on every push and pull request.

When adding cross-cutting logic:

- Put portable types and pure functions in `shared/`.
- Put React UI and hooks in `src/`.
- Put persistence, HTTP routes, and agent tools in `server/`.
- Put HTML fixtures used by multiple layers in `test/fixtures/` (import as `@fixtures/...` in Vitest).

## Examples

**Allowed**

```ts
// src/components/DeckPreview.tsx
import { validateDeckHtmlInBrowser } from '../../shared/deck-validate.ts'

// server/routes/decks.ts
import { validateDeckHtmlOnServer } from '../deck-validate.ts'

// server/deck-validate.ts
import { validateDeckHtml } from '../shared/deck-validate.ts'
```

**Forbidden**

```ts
// src/hooks/useDeckGenerationFlow.ts
import { parseDeckHtml } from '../../server/deck-parser.ts' // ❌

// server/deck-agent.ts
import { getPreviewHtml } from '../src/lib/deck-preview.ts' // ❌

// shared/deck-validate.ts
import express from 'express' // ❌
```

## Related docs

- [AGENTS.md](../AGENTS.md) — agent and contributor guide
- [README.md](../README.md) — setup and checks
