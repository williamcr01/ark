# Ark — Agent Guide

Ark is a presentation builder: a PowerPoint-like app where each presentation is a **single-page HTML file** (HTML + CSS, optionally libraries like reveal.js). Users provide data in a side chat; an AI agent generates and edits slides in real time.

## Product model

- **Shell app** (`src/`): React + TypeScript + Vite. Hosts the editor UI, slide preview, and agent chat panel.
- **Presentations** (`presentations/`): Self-contained `.html` files. Each file is one deck — portable, previewable in an iframe, and editable by the agent without touching React code.
- **Agent chat**: Side panel beside the slide preview. User supplies content (notes, data, bullet points); the agent writes or updates the active presentation HTML.

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

## Project layout (target)

```
ark/
├── src/                    # React shell app
│   ├── components/         # UI components (chat, preview, toolbar)
│   ├── hooks/              # shared React hooks
│   └── ...
├── presentations/          # generated / user presentation HTML files
│   └── *.html
├── public/                 # static assets
└── AGENTS.md               # this file
```

## React app conventions

- Functional components and hooks only.
- Colocate component styles (CSS modules or co-located `.css` files) — match existing patterns in the file you edit.
- Keep the shell thin: presentation rendering lives in HTML files, not in React components.
- Prefer extracting reusable logic into hooks under `src/hooks/`.
- Run `pnpm lint` after substantive changes.
- Run `pnpm format` before pushing substantive changes; CI enforces `pnpm format:check`.
- CI runs `pnpm lint`, `pnpm format:check`, `pnpm audit`, `pnpm build`, and `pnpm test` on every push to `main` and on pull requests (`.github/workflows/ci.yml`, Linux runner).

## Presentation HTML conventions

When creating or editing presentation files in `presentations/`:

1. **Self-contained**: One `.html` file per deck. Inline or `<style>` CSS; CDN scripts only when needed (e.g. reveal.js).
2. **Modern and polished**: Clean typography, consistent spacing, intentional color palette. Avoid generic “AI slop” aesthetics.
3. **Agent-friendly structure**: Use clear section/slide boundaries (e.g. `<section>` per slide for reveal.js, or commented `<!-- slide -->` markers for plain HTML).
4. **Safe preview**: Prefer `addEventListener` over inline handlers; use inline CSS, data URIs, and SVG — no external http(s) resource URLs.
5. **Incremental edits**: Prefer patching specific slides over rewriting the entire file when the user asks for small changes.

### Preview network isolation

Deck preview blocks all network access from generated or uploaded HTML:

- **CSP** — Ark injects `Content-Security-Policy` with `connect-src 'none'` and `default-src 'none'` into preview and thumbnail `srcDoc` iframes. Inline styles/scripts are allowed; external scripts, stylesheets, fonts, and images are blocked at runtime.
- **Validation** — `external_url` is a blocking error on upload, save, and generation. The preview chrome shows a clear banner when a loaded deck still contains external URLs.
- **Asset proxy** — `GET /api/deck-assets?url=...` can fetch allowlisted remote assets server-side when `ARK_DECK_ASSET_ALLOWLIST` is set. With no allowlist (default), all proxied requests return 403.

### Preview JavaScript

The shell uses two preview modes (see `detectPreviewMode` in `src/lib/deck-preview.ts`). The parent ↔ iframe contract is defined in `shared/deck-bridge.ts` and documented in `docs/deck-bridge.md`.

- **CSS-only** — deck scripts are stripped; Ark injects a navigation shim. Default for decks without executable `<script>`.
- **Full-JS** — deck scripts run only when `data-ark-deck="nav"` or `data-ark-preview="full-js"` is set (explicit opt-in). Without a marker, scripts are stripped even if present. Ark injects only a bridge (`postMessage` ↔ DOM `CustomEvent`). The deck owns navigation; shell state syncs on `ark:deck-slide-change` acknowledgements.

Thumbnails always strip scripts (`sandbox=""`). Main preview uses `sandbox="allow-scripts"` without `allow-same-origin`. Ark injects a strict CSP so deck scripts cannot make network requests; the UI shows a "Scripts running" indicator in full-JS mode. Preview is download-like, not identical (storage, popups, and permissions may differ).

Scripted decks with navigation must use `data-ark-deck="nav"` and the Ark bridge protocol (`ark:deck-goto`, `ark:deck-slide-change`, `ark:deck-ready`, etc.) documented in `docs/deck-bridge.md`.

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
- **Output**: Updated HTML in the active presentation file, or a new file in `presentations/`.
- **Workflow**: Confirm scope briefly, generate slides, then offer targeted follow-ups (e.g. “Want a dark theme?”).
- **Preview**: Assume the React shell loads the active `.html` in an iframe; broken markup breaks the preview — validate structure.
- **Scope**: Do not refactor the React shell unless the user asks; focus on presentation HTML and chat-related UI.

### Conversation context (issue #17)

Ark replays the **full visible chat history** on every `/api/generate` request (pi-style). Assistant turns store short status text plus optional tool-call parts — never full HTML.

- **Persisted with the deck**: Deck HTML is saved server-side (#10); chat messages are stored in `localStorage` (`ark:chat-session`) so refresh restores the conversation.
- **Assistant messages**: Store summary text and tool activity (`list_slides`, `read_deck`, `edit_deck`, `write_deck`). The model reads the deck via tools instead of receiving the full HTML on every turn.
- **Token/cost**: Follow-up edits use `edit_deck` patches instead of re-emitting the entire document. Long chats still replay prior text linearly; compaction is not implemented yet.

### Deck parser (issue #37)

Server-side structured parsing lives in `server/deck-parser.ts`. `parseDeckHtml` extracts title, runtime markers, slide structure (plain vs reveal), per-slide notes, style blocks, scripts, and asset references. Generation/editing services consume it via `server/deck-html.ts` and the `parse_deck` agent tool.

### Agent tool loop (issue #58)

Deck generation uses a **multi-step agent loop** (Vercel AI SDK `generateText` + `tools` + `stopWhen: stepCountIs(12)`), similar to [pi's coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent).

| Tool          | Purpose                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| `parse_deck`  | Structured deck metadata (title, runtime, slides, notes, styles, scripts, assets) |
| `list_slides` | Enumerate slide boundaries and titles                                             |
| `read_deck`   | Read full HTML by line offset/limit or a single slide by index                    |
| `edit_deck`   | Apply exact `oldText` → `newText` patches (pi-style; each match must be unique)   |
| `write_deck`  | Replace the entire deck (new decks or explicit full rewrites)                     |

Server implementation: `server/deck-parser.ts`, `server/deck-tools.ts`, `server/deck-agent.ts`. The client shows tool calls/results in chat and applies deck updates from tool results (final HTML returned in the API response).

One user message → one agent run → up to 12 tool/model steps → deck update + assistant summary.

## What to avoid

- Do not use npm or yarn — always pnpm.
- Do not embed presentation content in React JSX long-term; keep decks as HTML files.
- Do not add heavy dependencies to the shell without clear need.
- Do not rewrite entire presentations for minor edits.
- Do not commit secrets or API keys.

## Current state

Early scaffold: default Vite + React template. Presentation directory, chat panel, and iframe preview are not yet built — implement toward the layout and conventions above.

## Cursor Cloud specific instructions

Standard commands live in the `## Commands` section above and in `README.md`. Notes specific to this environment:

- **Dev server runs two processes.** `pnpm dev` uses `concurrently` to start the Express API (`tsx watch server/index.ts`) and the Vite client on `http://localhost:5173`. Both read `PORT` from `.env` or the environment (default `8787`); Vite proxies `/api` to that same port (see `vite.config.ts`). Always open the app on `5173`, not the API port. Run it in a background/tmux session since it stays attached.
- **API server endpoints:** `GET /api/health`, `GET /api/models`, `POST /api/generate` (tool-based agent loop). Health check is a quick liveness probe: `curl -s localhost:${PORT:-8787}/api/health`.
- **AI deck generation needs a provider key.** Add at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY` (in `.env` or the environment). Without a key, the chat shows an "API key required" alert and generation is disabled — but the rest of the app (uploading an `.html` deck, preview, slide navigation, thumbnails, Present mode) works fully. Restart `pnpm dev` after changing keys.
- **`.env` is gitignored and optional.** Copy it from `.env.example` if you want to set keys there; the app still boots without it (generation just stays disabled). Provider keys are read from `process.env`, so secrets injected into the environment work too.
- **No API keys required for CI.** Verification is `pnpm lint`, `pnpm format:check`, `pnpm audit`, `pnpm build`, and `pnpm test` (also enforced in GitHub Actions). Run `pnpm format` before pushing substantive changes. The fastest no-key smoke test of core functionality is the toolbar "Upload HTML" button to load a self-contained deck, then navigate slides and use Present mode.
