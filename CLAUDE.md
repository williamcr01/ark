# Ark — Agent Guide

Ark is a presentation builder: a PowerPoint-like app where each presentation is a **single-page HTML file** (HTML + CSS, optionally libraries like reveal.js). Users provide data in a side chat; an AI agent generates and edits slides in real time.

## Product model

- **Desktop app** (`apps/desktop/`): Electron main/preload processes plus the React + TypeScript + Vite renderer. Electron is the only product shell.
- **Local API** (`apps/api/`): Express services embedded in Electron. Persists decks and chat, runs generation, and serves approved runtime assets on loopback.
- **Sandbox host** (`apps/sandbox/`): Separate-origin preview renderer embedded in Electron with strict CSP isolation.
- **Workspace packages** (`packages/`): `@ark/contracts` (HTTP API Zod schemas), `@ark/deck` (deck document model), `@ark/chat` (conversation model), `@ark/agent` (generation loop), `@ark/runtime-registry` (approved runtime manifest and validation).
- **Decks**: Self-contained single-page HTML documents (HTML + CSS, optionally approved runtimes like reveal.js). Decks are persisted as local JSON under Electron `userData` and edited through the internal API/agent tools, not as repo files.
- **Agent chat**: Side panel beside the slide preview. User supplies content (notes, data, bullet points); the agent writes or updates the active deck HTML via tools.

## Tech stack

| Layer           | Choice                                           |
| --------------- | ------------------------------------------------ |
| Package manager | **pnpm** (never npm/yarn)                        |
| Framework       | React 19 + TypeScript                            |
| Desktop         | Electron 43                                      |
| Build           | Vite + Electron Builder                          |
| Presentations   | Plain HTML/CSS; reveal.js or similar when needed |
| Lint            | ESLint                                           |

## Commands

```bash
pnpm install    # install dependencies
pnpm dev        # open the watched Electron app
pnpm typecheck  # parallel native TypeScript check (all apps/packages)
pnpm build      # build renderer, main, and preload
pnpm package              # unpacked app for the current platform
pnpm package:installers   # installers for the current platform
pnpm lint       # oxlint, ESLint, package boundaries, structure budgets
pnpm test       # Vitest: packages in parallel, apps serial
```

## Project layout

Each package has one job and a fixed place in the stack; a package may import from lower layers
only. See [docs/architecture-boundaries.md](docs/architecture-boundaries.md).

```
ark/
├── apps/
│   ├── desktop/            # Electron main/preload + React renderer (`@ark/desktop`)
│   ├── api/                # Local HTTP API: composition, routes, thumbnails (`@ark/api`)
│   ├── sandbox/            # Separate-origin preview host (`@ark/sandbox`)
│   └── mcp/                # stdio MCP server executable (`@ark/mcp-server`)
├── packages/               #  L  package                one job
│   ├── runtime-registry/   #  0  approved runtime assets, pinned versions
│   ├── telemetry/          #  0  logging, redaction, request ids, timing
│   ├── deck/               #  1  the deck document model: read, patch, validate
│   ├── ai/                 #  1  providers, models, credentials, provider options
│   ├── editor-runtime/     #  2  manual editor protocol + injected script
│   ├── deck-export/        #  2  slide → scene model for PowerPoint export
│   ├── deck-import/        #  2  PowerPoint (.pptx) → Ark HTML (server-only)
│   ├── deck-node/          #  2  JSDOM HTML parse/validate/patch (server-only)
│   ├── chat/               #  2  messages, agent steps, jobs, agent protocols
│   ├── deck-preview/       #  3  deck → preview document, parent ↔ frame protocol
│   ├── storage/            #  4  records, stores, the `.ark` workspace file
│   ├── contracts/          #  5  HTTP API Zod schemas + OpenAPI registry
│   ├── agent/              #  6  the generation loop, its tools, the job runner
│   └── mcp/                #  7  Ark's deck tools exposed to external agents
├── test/                   # cross-layer HTML fixtures (`test/fixtures/`) for tests and smoke scripts
├── runtimes/               # vendored approved runtime assets (e.g. reveal.js) + manifest
├── agent-guides/           # always-on markdown appended to the deck agent system prompt
├── docs/                   # runtime/preview/bridge + backend architecture notes
├── scripts/                # runtime sync + smoke tests
├── data/                   # test/dev fixtures only; packaged data uses Electron userData
└── AGENTS.md               # this file
```

## Import boundaries

Enforced by `no-restricted-imports` (`eslint.config.js`, `.oxlintrc.json`) and by
`scripts/check-package-boundaries.mjs`, which checks the whole graph: every import must go to a
strictly lower layer, every workspace dependency must be both declared and used, and the root
`tsconfig.json` must reference every project. `pnpm lint` runs both.

- **A package may only import from a lower layer.** Two packages that need each other means one of
  them holds something that belongs further down. When a lower layer needs a shared type, define it
  there and re-export it upward, so consumers' import paths do not change — `@ark/contracts`
  re-exports the provider and reasoning enums from `@ark/ai`, deck ids and titles from `@ark/deck`,
  and job ids from `@ark/chat`.
- **Browser-safe packages** (no `node:*`, no Express, no React): `runtime-registry`, `telemetry`,
  `deck`, `ai`, `editor-runtime`, `deck-export`, `chat`, `deck-preview`, `contracts`. Two files opt out by name:
  `runtime-stylesheet-disk.ts` and `telemetry/request-id.ts`.
- **Server-only packages**: `storage`, `agent`, `mcp`, `deck-import`, `deck-node`. `apps/desktop/src` must not import them.
- `apps/desktop/src` (the renderer) may import browser-safe packages only — never `apps/api`.
- `apps/desktop/electron` (the trusted main process) owns and may import `@ark/api` and
  `@ark/sandbox`.
- `apps/api`, `apps/sandbox`, and `apps/mcp` must never import from `apps/desktop`.
- `packages/*` must not import from `apps/`.
- Cross-layer HTML fixtures live in `test/fixtures/` (Vitest alias `@fixtures/...`).
- HTTP API contracts live in `packages/contracts/` — import from `@ark/contracts` in application
  code. See [packages/contracts/README.md](packages/contracts/README.md).

Each package has a `README.md` stating its one job and what it may import. Read it before adding a
module there.

## React app conventions

- Functional components and hooks only.
- Colocate component styles (CSS modules or co-located `.css` files) — match existing patterns in the file you edit.
- Keep the shell thin: presentation rendering lives in HTML files, not in React components.
- Prefer extracting reusable logic into hooks under `src/hooks/`.
- Run `pnpm lint` after substantive changes.
- Always run `pnpm format` before committing; CI enforces `pnpm format:check`.
- CI runs `quality` (lockfile/lint/format/audit/openapi), `build`, `test`, and `smoke` on every push to `main` and on pull requests (`.github/workflows/ci.yml`, Linux runner).

## Presentation HTML conventions

When creating or editing deck HTML (through the agent tools or upload):

1. **Self-contained**: One `.html` file per deck. Inline `<style>` CSS; no external http(s) URLs for scripts, stylesheets, fonts, or images.
2. **Modern and polished**: Clean typography, consistent spacing, intentional color palette. Avoid generic “AI slop” aesthetics.
3. **Agent-friendly structure**: Use clear section/slide boundaries (e.g. `<section class="slide">` for plain decks, or `.reveal > .slides > section` for reveal.js — see [docs/reveal-runtime.md](docs/reveal-runtime.md)).
4. **Safe preview**: Prefer `addEventListener` over inline handlers; use inline CSS, data URIs, and SVG — no external http(s) resource URLs.
5. **Incremental edits**: Prefer patching specific slides over rewriting the entire file when the user asks for small changes.
6. **Approved runtimes**: Use pinned `/api/runtimes/...` assets from the registry — never CDNs. See [docs/runtimes.md](docs/runtimes.md), [docs/reveal-runtime.md](docs/reveal-runtime.md), and [docs/chart-runtime.md](docs/chart-runtime.md).

### Preview network isolation

Deck preview blocks external **fetches, resource loads, and navigations** from generated or uploaded HTML (scripts, stylesheets, fonts, images, XHR/fetch).

- **Sandbox host** — Main preview and Present mode load decks from Electron's separate dynamically allocated loopback origin using short-lived render tokens from `POST /api/preview-sessions`. The sandbox host applies strict CSP/COOP/CORP response headers and does not share app cookies or storage.
- **CSP** — Ark injects `Content-Security-Policy` with `connect-src 'none'` and `default-src 'none'` into preview documents (HTTP headers on the sandbox host; meta tags in thumbnail `srcDoc` fallbacks). Inline styles/scripts are allowed; external scripts, stylesheets, fonts, and images are blocked at runtime.
- **Validation** — `external_url` is a blocking error on upload, save, and generation. The preview chrome shows a clear banner when a loaded deck still contains external URLs.
- **Asset proxy** — `GET /api/deck-assets?url=...` can fetch allowlisted remote assets server-side when `ARK_DECK_ASSET_ALLOWLIST` is set. With no allowlist (default), all proxied requests return 403.
- **Frame self-navigation** — CSP cannot block a sandboxed iframe from navigating itself, so Electron's session request filter cancels navigation to every origin outside Ark's exact loopback set before it reaches the network. The shell's ref-gated bridge session and head-first `ark:deck-handshake` remain defense in depth: an unexpected load synchronously blocks parent→frame traffic, tears down the preview, and reports through `POST /api/runtime-errors`.

### Preview JavaScript

The shell uses preview modes based on runtime detection (see `detectRuntimeMode` in `src/lib/deck/deck-runtime.ts`). The parent ↔ iframe contract is defined in `packages/deck-preview/deck-bridge.ts` and documented in [docs/deck-bridge.md](docs/deck-bridge.md). Manual editing uses a separate editor bridge (`packages/editor-runtime/`) documented in [docs/deck-editor-bridge.md](docs/deck-editor-bridge.md).

- **CSS-only** — deck scripts are stripped; Ark injects a navigation shim. Default for plain decks and reveal decks without approved runtime assets.
- **Full-JS (custom)** — deck scripts run when `data-ark-deck="nav"` or `data-ark-preview="full-js"` is set. Ark injects a bridge (`postMessage` ↔ DOM `CustomEvent`); the deck owns navigation.
- **Full-JS (reveal adapter)** — reveal decks with approved registry markers and `/api/runtimes/reveal.js/5.1.0/reveal.js` get Ark's reveal navigation adapter automatically. No deck-authored bridge script. See [docs/reveal-runtime.md](docs/reveal-runtime.md).

Thumbnails use a hidden sandboxed Electron `BrowserWindow` and `webContents.capturePage()`; the strip falls back to script-stripped `srcDoc` iframes (`sandbox=""`) while rendering is pending or failed. Main preview uses `sandbox="allow-scripts"` without `allow-same-origin`, loaded from the sandbox host URL. Approved runtime asset URLs are absolutized to the app origin in preview. Parent ↔ deck `postMessage` is scoped to the dynamic app/sandbox origins. Ark injects a strict CSP and Electron denies non-loopback renderer traffic.

Custom scripted decks with navigation must use `data-ark-deck="nav"` and the Ark bridge protocol (`ark:deck-goto`, `ark:deck-slide-change`, `ark:deck-ready`, etc.).

Example skeleton (plain HTML):

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Deck Title</title>
    <style>
      /* deck styles */
    </style>
  </head>
  <body>
    <!-- slide: Title -->
    <section class="slide">...</section>
    <!-- slide: Agenda -->
    <section class="slide">...</section>
  </body>
</html>
```

## Agent chat behavior

When acting as the presentation agent (side chat):

- **Input**: User provides raw content — notes, CSV snippets, bullet lists, images URLs, tone/style preferences.
- **Output**: Updated HTML for the active deck (persisted locally), or a new deck.
- **Workflow**: Confirm scope briefly, generate slides, then offer targeted follow-ups (e.g. “Want a dark theme?”).
- **Preview**: Assume the React shell loads the active `.html` in an iframe; broken markup breaks the preview — validate structure.
- **Scope**: Do not refactor the React shell unless the user asks; focus on presentation HTML and chat-related UI.

### Conversation context (issue #17)

Ark replays the **full visible chat history** on every generation job request, including prior user turns, assistant text, tool calls, and paired tool results. Vercel AI SDK owns tool-result continuation within a single job.

- **Persisted with the deck**: Deck HTML and chat messages are saved by the local API under Electron `userData`; renderer storage (`ark:chat-session:{deckId|new}`) acts as a cache/fallback. Chat for a not-yet-saved deck lives only in renderer storage until the deck is created.
- **Assistant messages**: Durable chat keeps every logical step using recoverable, tool-specific projections, never repeated full deck HTML. Model-only context projection may summarize older steps and tells the model to re-read authoritative deck state.
- **Token/cost**: Follow-up edits use patches instead of re-emitting the document. Context assembly is separate from append-only persistence; future compaction is documented in `docs/agent-context.md` but is not implemented.
- **Deck origin**: Ark creates a deck before the first message, so `workspace.origin` (`blank` | `authored`, see `packages/deck/document/origin.ts`) records whether the HTML is the user's work or Ark's untouched starter deck. The job runner reads it from the stored record and `wrapUserPromptForAgent` uses it to pick the new-deck flow (ask questions, propose themes) over the revise flow. The first write that changes the document retires `blank` permanently. Adding a `template` origin is issue #278.

### Deck parser (issue #37)

Structured parsing lives in `packages/deck/document/parser.ts`. `parseDeckHtml` extracts title, runtime markers, slide structure (plain vs reveal), per-slide notes, style blocks, scripts, and asset references. Generation/editing services consume it through the internal API and the `parse_deck` agent tool.

### Always-on agent guides

Markdown files under `agent-guides/` are automatically loaded and appended to the deck agent system prompt on every generation job (alongside tool definitions and chat history). Use numeric prefixes for ordering (`10-reveal-js.md`, `20-chart-js.md`); `README.md` and `_*.md` are excluded. Hard validation rules stay in the core prompt; guides hold longer authoring patterns. Packaged resources are resolved by the Electron main process.

### Agent tool loop (issue #58)

Deck generation uses a **multi-step agent loop** (Vercel AI SDK `streamText` + `tools`; stops naturally or when the user aborts).

| Tool          | Purpose                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `parse_deck`  | Structured deck metadata (title, runtime, slides, notes, styles, scripts, assets)                                 |
| `list_slides` | Enumerate slide boundaries and titles                                                                             |
| `read_deck`   | Read full HTML by line offset/limit or a single slide by index                                                    |
| `patch_deck`  | Structured slide-level operations (add, delete, replace, reorder, title, notes) — **preferred** for slide changes |
| `edit_deck`   | Apply exact `oldText` → `newText` patches (each match must be unique)                                             |
| `write_deck`  | Replace the entire deck (new decks or explicit full rewrites)                                                     |

Implementation: `packages/deck/document/parser.ts`, `packages/agent/tools.ts`, `packages/agent/agent.ts`. The renderer shows tool calls/results in chat and applies deck updates returned by the internal API.

One user message → one agent run → as many tool/model steps as needed → deck update + assistant summary.

## Licensing

- Check licenses before adding or upgrading dependencies (direct or notable transitive) and before vendoring assets such as fonts, runtimes, or scripts.
- Prefer permissive, commercial SaaS-friendly licenses: MIT, Apache-2.0, BSD, ISC, 0BSD, BlueOak, and OFL for fonts. For dual-licensed packages, choose the permissive option (e.g. Apache-2.0 over MPL).
- Avoid or escalate copyleft/restrictive terms that can conflict with closed-source SaaS use: GPL, AGPL, SSPL, BUSL, Commons Clause, or proprietary licenses without a commercial grant.
- When redistributing fonts/assets, keep their LICENSE/NOTICE files with the redistributed files and update the root `NOTICE` when present.

## What to avoid

- Do not use npm or yarn — always pnpm.
- Do not embed presentation content in React JSX long-term; keep decks as self-contained HTML documents.
- Do not add heavy dependencies to the shell without clear need.
- Do not rewrite entire presentations for minor edits.
- Do not commit secrets or API keys.

## Current state

Fully working editor, not a scaffold. Implemented today:

- **Local multi-deck persistence** with immutable versions and rollback under Electron `userData`.
- **Local chat persistence** per deck with renderer storage caching.
- **Tool-based agent generation** via async generation jobs (create/status/cancel/retry) with observability.
- **Sandboxed preview** on a separate dynamic loopback origin with CSP isolation, CSS-only and full-JS modes, Electron-captured PNG thumbnails with `srcDoc` fallback, and Present mode.
- **BYOK settings** backed by Electron `safeStorage`, with add/remove/test controls for each provider.
- **Desktop packaging** for Linux, macOS, and Windows with GitHub Releases and `electron-updater`.
- **Approved runtime registry** with vendored reveal.js 5.1.0 and chart.js 4.5.1 served from `/api/runtimes/...`.
- **PowerPoint import** from Import PowerPoint (and the Open dialog) into a **new** `.ark` workspace. Local OOXML conversion only; speaker notes and `ark-asset:` images come along. See [packages/deck-import/README.md](packages/deck-import/README.md).
- **Manual editing**: CSS-only, approved Reveal, Reveal+Chart.js, and custom-JS decks support PowerPoint-style selection and movement through the sandbox-safe editor bridge ([docs/deck-editor-bridge.md](docs/deck-editor-bridge.md), `packages/editor-runtime/`) and structured element patch API (`POST /api/decks/:id/patch`). The editor uses a private per-preview `MessagePort` established before deck-authored scripts run, so scripted decks cannot forge editor commits through public `postMessage`. Users can select deck-authored text, images, SVG, and containers; move or resize unlocked elements with snapping and keyboard nudge; insert text boxes/images; edit text and properties; duplicate, delete, reorder; and undo/redo. Moving unmanaged content adopts it into Ark's absolute layout while preserving its containing block and measured width. Selection chrome adapts to light/dark surfaces and preview scale.

Typed contracts shared by the renderer and local API live in `packages/contracts/` (`@ark/contracts`).

## Cursor Cloud specific instructions

Standard commands live in the `## Commands` section above and in `README.md`. Notes specific to this environment:

- **Development opens Electron.** `pnpm dev` watches the renderer, main, and preload bundles and launches Electron. Do not open the internal loopback ports in a browser.
- **Provider keys live in Settings.** Add, remove, and test OpenAI, Anthropic, or Google keys in the desktop UI. They are encrypted through `safeStorage`; `.env` provider keys are not part of the app workflow.
- **No API keys are required for CI.** Required PR checks keep stable `quality`, `build`, `test`, and `smoke` names. Tag builds run the Linux/macOS/Windows release matrix. Always run `pnpm format` before committing.
