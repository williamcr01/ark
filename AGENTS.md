# Ark — Agent Guide

Ark is a presentation builder: a PowerPoint-like app where each presentation is a **single-page HTML file** (HTML + CSS, optionally libraries like reveal.js). Users provide data in a side chat; an AI agent generates and edits slides in real time.

## Product model

- **Shell app** (`src/`): React + TypeScript + Vite. Hosts the editor UI, slide preview, and agent chat panel.
- **Presentations** (`presentations/`): Self-contained `.html` files. Each file is one deck — portable, previewable in an iframe, and editable by the agent without touching React code.
- **Agent chat**: Side panel beside the slide preview. User supplies content (notes, data, bullet points); the agent writes or updates the active presentation HTML.

## Tech stack

| Layer | Choice |
|-------|--------|
| Package manager | **pnpm** (never npm/yarn) |
| Framework | React 19 + TypeScript |
| Build | Vite |
| Presentations | Plain HTML/CSS; reveal.js or similar when needed |
| Lint | ESLint |

## Commands

```bash
pnpm install    # install dependencies
pnpm dev        # start dev server
pnpm build      # typecheck + production build
pnpm lint       # run ESLint
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

## Presentation HTML conventions

When creating or editing presentation files in `presentations/`:

1. **Self-contained**: One `.html` file per deck. Inline or `<style>` CSS; CDN scripts only when needed (e.g. reveal.js).
2. **Modern and polished**: Clean typography, consistent spacing, intentional color palette. Avoid generic “AI slop” aesthetics.
3. **Agent-friendly structure**: Use clear section/slide boundaries (e.g. `<section>` per slide for reveal.js, or commented `<!-- slide -->` markers for plain HTML).
4. **Safe preview**: Prefer `addEventListener` over inline handlers; assets use relative paths or well-known CDNs.
5. **Incremental edits**: Prefer patching specific slides over rewriting the entire file when the user asks for small changes.

### Preview JavaScript

The shell uses two preview modes (see `detectPreviewMode` in `src/lib/deck-preview.ts`):

- **CSS-only** — deck scripts are stripped; Ark injects a navigation shim. Default for decks without executable `<script>`.
- **Full-JS** — deck scripts run only when `data-ark-deck="nav"` or `data-ark-preview="full-js"` is set (explicit opt-in). Without a marker, scripts are stripped even if present. Ark injects only a bridge (`postMessage` ↔ DOM `CustomEvent`). The deck owns navigation; shell state syncs on `ark:deck-slide-change` acknowledgements.

Thumbnails always strip scripts (`sandbox=""`). Main preview uses `sandbox="allow-scripts"` without `allow-same-origin` — user-provided code can run network requests; the UI shows a "Scripts running" indicator in full-JS mode. Preview is download-like, not identical (storage, popups, and permissions may differ).

Scripted decks with navigation must use `data-ark-deck="nav"` and the Ark DOM event convention documented in `server/index.ts`.

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

Ark replays the **full visible chat history** on every `/api/generate` request (pi-style), plus the latest deck HTML when editing. This lets follow-ups like “make the title bigger” work without repeating prior instructions.

- **Persisted with the deck**: Chat messages and HTML are stored together in `localStorage` (`ark:deck-session`) so refresh restores the conversation.
- **Assistant messages**: Store short status text only — never full generated HTML. The model always receives `currentHtml` separately on the latest turn.
- **Token/cost**: Each request includes all prior user/assistant text plus the full current HTML on the latest turn. Long chats and large decks increase input tokens linearly; compaction/summarization is not implemented yet.

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
- **API server endpoints:** `GET /api/health`, `GET /api/models`, `POST /api/generate`. Health check is a quick liveness probe: `curl -s localhost:${PORT:-8787}/api/health`.
- **AI deck generation needs a provider key.** Add at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY` (in `.env` or the environment). Without a key, the chat shows an "API key required" alert and generation is disabled — but the rest of the app (uploading an `.html` deck, preview, slide navigation, thumbnails, Present mode) works fully. Restart `pnpm dev` after changing keys.
- **`.env` is gitignored and optional.** Copy it from `.env.example` if you want to set keys there; the app still boots without it (generation just stays disabled). Provider keys are read from `process.env`, so secrets injected into the environment work too.
- **No automated test suite.** Verification is `pnpm lint`, `pnpm build` (runs `tsc -b` then `vite build`), plus manual browser checks. The fastest no-key smoke test of core functionality is the toolbar "Upload HTML" button to load a self-contained deck, then navigate slides and use Present mode.
