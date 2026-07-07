# Ark — Agent Guide

Ark is a presentation builder: a PowerPoint-like app where each presentation is a **single-page HTML file** (HTML + CSS, optionally libraries like reveal.js). Users provide data in a side chat; an AI agent generates and edits slides in real time.

## Product model

- **Shell app** (`src/`): React + TypeScript + Vite. Hosts the editor UI, slide preview, and agent chat panel.
- **API server** (`server/`): Express. Persists decks and chat, runs the generation agent loop, serves approved runtime assets, and hosts the sandbox preview origin.
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
pnpm test       # run unit tests (Vitest)
pnpm preview    # preview production build
```

## Project layout

```
ark/
├── src/                    # React shell app
│   ├── components/         # UI components (chat, preview, toolbar)
│   ├── hooks/              # shared React hooks
│   └── lib/                # client-side helpers (deck preview, validation, API)
├── server/                 # Express API, agent loop, deck/chat stores, sandbox host
│   └── db/                 # Postgres repositories + migrations (optional path)
├── shared/                 # code shared by client and server (bridge, patches, API contracts)
├── test/                   # cross-layer HTML fixtures (`test/fixtures/`) for tests and smoke scripts
├── runtimes/               # vendored approved runtime assets (e.g. reveal.js) + manifest
├── docs/                   # runtime/preview/bridge documentation
├── scripts/                # runtime sync + smoke tests
├── data/                   # local dev persistence (gitignored): decks, chat
├── public/                 # static assets
└── AGENTS.md               # this file
```

## Import boundaries

`src/`, `server/`, and `shared/` have enforced dependency directions (issue #131):

- `src/` may import from `shared/` only — never from `server/`.
- `server/` may import from `shared/` only — never from `src/`.
- `shared/` must not import from `src/` or `server/`, and must not depend on React, Express, or Node/browser APIs unless the filename makes the environment explicit (e.g. `*-disk.ts`).
- Cross-layer HTML fixtures live in `test/fixtures/` (Vitest alias `@fixtures/...`).

`pnpm lint` fails on forbidden imports. See [docs/architecture-boundaries.md](docs/architecture-boundaries.md).

## React app conventions

- Functional components and hooks only.
- Colocate component styles (CSS modules or co-located `.css` files) — match existing patterns in the file you edit.
- Keep the shell thin: presentation rendering lives in HTML files, not in React components.
- Prefer extracting reusable logic into hooks under `src/hooks/`.
- Run `pnpm lint` after substantive changes.
- Always run `pnpm format` before committing; CI enforces `pnpm format:check`.
- CI runs `pnpm lint`, `pnpm format:check`, `pnpm audit`, `pnpm build`, and `pnpm test` on every push to `main` and on pull requests (`.github/workflows/ci.yml`, Linux runner).

## Presentation HTML conventions

When creating or editing deck HTML (through the agent tools or upload):

1. **Self-contained**: One `.html` file per deck. Inline `<style>` CSS; no external http(s) URLs for scripts, stylesheets, fonts, or images.
2. **Modern and polished**: Clean typography, consistent spacing, intentional color palette. Avoid generic “AI slop” aesthetics.
3. **Agent-friendly structure**: Use clear section/slide boundaries (e.g. `<section class="slide">` for plain decks, or `.reveal > .slides > section` for reveal.js — see [docs/reveal-runtime.md](docs/reveal-runtime.md)).
4. **Safe preview**: Prefer `addEventListener` over inline handlers; use inline CSS, data URIs, and SVG — no external http(s) resource URLs.
5. **Incremental edits**: Prefer patching specific slides over rewriting the entire file when the user asks for small changes.
6. **Approved runtimes**: Use pinned `/api/runtimes/...` assets from the registry — never CDNs. See [docs/runtimes.md](docs/runtimes.md) and [docs/reveal-runtime.md](docs/reveal-runtime.md).

### Preview network isolation

Deck preview blocks all network access from generated or uploaded HTML:

- **Sandbox host** — Main preview and Present mode load decks from a separate origin (default `http://localhost:5174`) using short-lived render tokens from `POST /api/preview-sessions`. The sandbox host applies strict CSP/COOP/CORP response headers and does not share app cookies or storage.
- **CSP** — Ark injects `Content-Security-Policy` with `connect-src 'none'` and `default-src 'none'` into preview documents (HTTP headers on the sandbox host; meta tags in thumbnail `srcDoc` iframes). Inline styles/scripts are allowed; external scripts, stylesheets, fonts, and images are blocked at runtime.
- **Validation** — `external_url` is a blocking error on upload, save, and generation. The preview chrome shows a clear banner when a loaded deck still contains external URLs.
- **Asset proxy** — `GET /api/deck-assets?url=...` can fetch allowlisted remote assets server-side when `ARK_DECK_ASSET_ALLOWLIST` is set. With no allowlist (default), all proxied requests return 403.

### Preview JavaScript

The shell uses preview modes based on runtime detection (see `detectPreviewMode` in `src/lib/deck-preview.ts`). The parent ↔ iframe contract is defined in `shared/deck-bridge.ts` and documented in [docs/deck-bridge.md](docs/deck-bridge.md). Manual editing uses a separate editor bridge (`shared/deck-editor-bridge.ts`) documented in [docs/deck-editor-bridge.md](docs/deck-editor-bridge.md).

- **CSS-only** — deck scripts are stripped; Ark injects a navigation shim. Default for plain decks and reveal decks without approved runtime assets.
- **Full-JS (custom)** — deck scripts run when `data-ark-deck="nav"` or `data-ark-preview="full-js"` is set. Ark injects a bridge (`postMessage` ↔ DOM `CustomEvent`); the deck owns navigation.
- **Full-JS (reveal adapter)** — reveal decks with approved registry markers and `/api/runtimes/reveal.js/5.1.0/reveal.js` get Ark's reveal navigation adapter automatically. No deck-authored bridge script. See [docs/reveal-runtime.md](docs/reveal-runtime.md).

Thumbnails always strip scripts (`sandbox=""`). Main preview uses `sandbox="allow-scripts"` without `allow-same-origin`, loaded from the sandbox host URL by default (`VITE_ARK_PREVIEW_SRCDOC=true` restores legacy `srcDoc`). Approved runtime asset URLs are absolutized to the app origin in preview. Parent ↔ deck `postMessage` is scoped to the configured app/sandbox origins. Ark injects a strict CSP so deck scripts cannot make network requests; the UI shows a "Scripts running" indicator in full-JS mode.

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

Ark replays the **full visible chat history** on every generation job request (pi-style). Assistant turns store short status text plus optional tool-call parts — never full HTML.

- **Persisted with the deck**: Deck HTML is saved server-side (#10). Chat messages are also persisted server-side per deck (`GET/POST/DELETE /api/decks/:id/chat`, JSON files under `data/chat/` or Postgres); `localStorage` (`ark:chat-session:{deckId|new}`) acts as a client-side cache/fallback so refresh restores the conversation even when the API is briefly unavailable. Chat for a not-yet-saved deck lives only in `localStorage` until the deck is created.
- **Assistant messages**: Store summary text and tool activity (`list_slides`, `read_deck`, `patch_deck`, `edit_deck`, `write_deck`). The model reads the deck via tools instead of receiving the full HTML on every turn.
- **Token/cost**: Follow-up edits use `patch_deck`/`edit_deck` patches instead of re-emitting the entire document. Long chats still replay prior text linearly; compaction is not implemented yet.

### Deck parser (issue #37)

Server-side structured parsing lives in `server/deck-parser.ts`. `parseDeckHtml` extracts title, runtime markers, slide structure (plain vs reveal), per-slide notes, style blocks, scripts, and asset references. Generation/editing services consume it via `server/deck-html.ts` and the `parse_deck` agent tool.

### Agent tool loop (issue #58)

Deck generation uses a **multi-step agent loop** (Vercel AI SDK `generateText` + `tools` + `stopWhen: stepCountIs(12)`), similar to [pi's coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent).

| Tool          | Purpose                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `parse_deck`  | Structured deck metadata (title, runtime, slides, notes, styles, scripts, assets)                                 |
| `list_slides` | Enumerate slide boundaries and titles                                                                             |
| `read_deck`   | Read full HTML by line offset/limit or a single slide by index                                                    |
| `patch_deck`  | Structured slide-level operations (add, delete, replace, reorder, title, notes) — **preferred** for slide changes |
| `edit_deck`   | Apply exact `oldText` → `newText` patches (pi-style; each match must be unique)                                   |
| `write_deck`  | Replace the entire deck (new decks or explicit full rewrites)                                                     |

Server implementation: `server/deck-parser.ts`, `server/deck-tools.ts`, `server/deck-agent.ts`. The client shows tool calls/results in chat and applies deck updates from tool results (final HTML returned in the API response).

One user message → one agent run → up to 12 tool/model steps → deck update + assistant summary.

## What to avoid

- Do not use npm or yarn — always pnpm.
- Do not embed presentation content in React JSX long-term; keep decks as self-contained HTML documents.
- Do not add heavy dependencies to the shell without clear need.
- Do not rewrite entire presentations for minor edits.
- Do not commit secrets or API keys.

## Current state

Fully working editor, not a scaffold. Implemented today:

- **Multi-deck persistence** with immutable versions and rollback (JSON files under `data/` by default; Postgres repositories + migrations under `server/db/` when `DATABASE_URL` is set).
- **Server-persisted chat** per deck with `localStorage` caching.
- **Tool-based agent generation** via async generation jobs (create/status/cancel/retry) with observability.
- **Sandboxed preview** on a separate origin with CSP isolation, CSS-only and full-JS modes, thumbnails, and Present mode.
- **Approved runtime registry** with vendored reveal.js 5.1.0 served from `/api/runtimes/...`.
- **Manual editing (in progress)**: editable element metadata, sandbox-safe editor bridge protocol ([docs/deck-editor-bridge.md](docs/deck-editor-bridge.md), `shared/deck-editor-bridge.ts`), and a structured element patch API (`POST /api/decks/:id/patch`) are in place; inline text editing, toolbar, and text boxes ship today. Client-side undo/redo with manual-edit provenance (#82) is implemented via `src/hooks/useDeckEditHistory.ts` and `shared/deck-edit-provenance.ts` — each committed manual edit records before/after HTML snapshots plus structured provenance (source, operation, slide indexes, element ids, summary), and AI generation/upload/rollback act as history boundaries. Remaining manual-editing work (image insertion, etc.) is tracked in issues #76 and #78–#84.

Typed API contracts shared by client and server live in `shared/api/`.

## Cursor Cloud specific instructions

Standard commands live in the `## Commands` section above and in `README.md`. Notes specific to this environment:

- **Dev server runs three processes.** `pnpm dev` uses `concurrently` to start the Express API (`tsx watch server/index.ts`), the sandbox preview host (`tsx watch server/sandbox-index.ts`, default `http://localhost:5174`), and the Vite client on `http://localhost:5173`. The API reads `PORT` from `.env` or the environment (default `8787`); Vite proxies `/api` to that same port (see `vite.config.ts`). Always open the app on `5173`, not the API or sandbox ports directly. Run it in a background/tmux session since it stays attached.
- **API server endpoints:** `GET /api/health`, `GET /api/models`, deck CRUD (`GET/POST /api/decks`, `GET/PUT/PATCH/DELETE /api/decks/:id`), element patches (`POST /api/decks/:id/patch`), versions (`GET /api/decks/:id/versions`, `GET /api/decks/:id/versions/:versionId`, `POST /api/decks/:id/rollback`), chat (`GET /api/decks/:id/chat`, `POST /api/decks/:id/chat/messages`, `DELETE /api/decks/:id/chat`), generation jobs (`POST /api/generation-jobs`, `GET /api/generation-jobs/:id`, `POST .../cancel`, `POST .../retry`), preview sessions (`POST /api/preview-sessions`, `GET /api/preview-sessions/:token`), `POST /api/runtime-errors`, and `GET /api/deck-assets`. Health check is a quick liveness probe: `curl -s localhost:${PORT:-8787}/api/health`.
- **AI deck generation needs a provider key.** Add at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY` (in `.env` or the environment). Without a key, the chat shows an "API key required" alert and generation is disabled — but the rest of the app (uploading an `.html` deck, preview, slide navigation, thumbnails, Present mode) works fully. Restart `pnpm dev` after changing keys.
- **`.env` is gitignored and optional.** Copy it from `.env.example` if you want to set keys there; the app still boots without it (generation just stays disabled). Provider keys are read from `process.env`, so secrets injected into the environment work too.
- **No API keys required for CI.** Verification is `pnpm lockfile:check`, `pnpm lint`, `pnpm format:check`, `pnpm audit`, `pnpm build`, `pnpm test`, and `pnpm smoke:browser` (also enforced in GitHub Actions). CI pins `ARK_CHROMIUM_PATH=/usr/bin/google-chrome` so the headless browser smoke tests use the preinstalled Chrome on `ubuntu-latest`. Always run `pnpm format` before committing. The fastest no-key smoke test of core functionality is the toolbar "Upload HTML" button to load a self-contained deck, then navigate slides and use Present mode.
