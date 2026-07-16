# Agent guides

Markdown files in this directory are **always** appended to the deck agent system prompt on every generation job.

They are for longer reference material (runtime authoring patterns, examples, best practices) that would bloat the core system prompt in `apps/api/deck-agent.ts`.

## Convention

| Rule    | Behavior                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| Include | All `*.md` files directly in this directory (non-recursive)                                                |
| Order   | Lexicographic by filename — use numeric prefixes (`00-base-rules.md`, `10-reveal-js.md`, `20-chart-js.md`) |
| Exclude | This `README.md`, and files starting with `_`                                                              |
| Content | Plain markdown. Optional YAML frontmatter is reserved for later; treat the whole file as content for now   |

Server-side validators still enforce hard constraints (self-contained HTML, no external URLs, required markers). Agent-facing copies of those rules live in guides such as `00-base-rules.md` so they can be edited without changing code.

Do **not** duplicate the live approved-runtime URL list here — that is generated dynamically from `runtimes/manifest.json` via `buildRuntimeRegistryPromptSection()`.

## Editing

In development (`NODE_ENV !== 'production'`), the API re-reads files when mtimes change, so you can edit guides without restarting `pnpm dev`.

Optional env overrides (see `.env.example`):

- `ARK_AGENT_GUIDES_DIR` — alternate directory
- `ARK_AGENT_GUIDES_MAX_BYTES` — truncate concatenated guides past this size (default 131072)

## Adding a guide

1. Create `NN-topic.md` with a clear numeric prefix for ordering.
2. Write model-oriented instructions (skeletons, do/don't lists, feature limits).
3. Keep human-facing docs under `docs/`; adapt rather than symlink so agent text can stay shorter and more directive.
