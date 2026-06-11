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
4. **Safe preview**: No inline event handlers that require server context; assets use relative paths or well-known CDNs.
5. **Incremental edits**: Prefer patching specific slides over rewriting the entire file when the user asks for small changes.

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

## What to avoid

- Do not use npm or yarn — always pnpm.
- Do not embed presentation content in React JSX long-term; keep decks as HTML files.
- Do not add heavy dependencies to the shell without clear need.
- Do not rewrite entire presentations for minor edits.
- Do not commit secrets or API keys.

## Current state

Early scaffold: default Vite + React template. Presentation directory, chat panel, and iframe preview are not yet built — implement toward the layout and conventions above.
