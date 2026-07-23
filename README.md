# Ark

Ark is an AI-first presentation builder. Describe a deck in plain language, and Ark generates a portable single-page HTML presentation that previews in an iframe and can be downloaded as `.html`.

## Setup

```bash
pnpm install
cp .env.example .env
```

Add at least one provider API key to `.env`:

```env
OPENAI_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
```

You only need one key to get started. Add more providers to unlock their models in the UI.

### Choosing a model

You can pick the model in two ways:

1. **In the UI (recommended)** — Open the chat panel and use the model dropdown in the prompt input footer. Ark shows a curated catalog of OpenAI, Claude, and Gemini models. Hover a reasoning model to pick thinking effort from that model's supported levels. Your model and effort choices are saved in the browser.

2. **In `.env` (default fallback)** — Set `ARK_DEFAULT_MODEL` using `provider:model-id` syntax when no model is saved in the UI yet:

```env
ARK_DEFAULT_MODEL=anthropic:claude-sonnet-5
```

`OPENAI_MODEL` is still supported as a legacy OpenAI-only default. Defaults should reference a curated catalog entry (for example `openai:gpt-5.6-luna`).

Optional API port (default `8787`). Both the Express API and Vite's `/api` proxy read `PORT` from `.env` or your shell environment — keep them in sync by setting it once and restarting `pnpm dev`:

```env
PORT=8787
```

### Optional Postgres persistence

By default, Ark stores decks as local JSON files under `data/decks` so development works without a database. To use the hosted-SaaS persistence path, set `DATABASE_URL` and run migrations:

```env
DATABASE_URL=postgres://ark:ark@localhost:5432/ark
PGSSLMODE=disable
```

```bash
pnpm db:migrate
```

`PGSSLMODE=require` enables verified TLS for managed Postgres providers. `PGSSLMODE=no-verify` is available for providers that require TLS but do not expose a locally trusted certificate chain. The schema uses standard Postgres tables, UUIDs, constraints, indexes, and `jsonb`, so it can run on local Postgres, Supabase Postgres, Neon, AWS RDS/Aurora Postgres, Azure Database for PostgreSQL, and similar hosted Postgres services.

### Supported providers

| Provider | Env var                        | Models source                                                   |
| -------- | ------------------------------ | --------------------------------------------------------------- |
| OpenAI   | `OPENAI_API_KEY`               | Curated catalog (GPT-5.6 Sol/Terra/Luna, GPT-5.5, GPT-5.4 Mini) |
| Claude   | `ANTHROPIC_API_KEY`            | Curated catalog (Fable 5, Opus 4.8, Sonnet 5, Haiku 4.5)        |
| Gemini   | `GOOGLE_GENERATIVE_AI_API_KEY` | Curated catalog (3.6 Flash, 3.5 Flash, 3.5 Flash-Lite, 3.1 Pro) |

### API key errors

If `.env` has no provider keys, still has placeholder values, or a key is rejected, generation stays disabled for that provider's models until you fix it. Models for providers without a key appear in the picker as unavailable. After updating `.env`, restart `pnpm dev`.

## Development

```bash
pnpm dev
```

This starts:

- Vite app: `http://localhost:5173` (proxies `/api` to the port below)
- local API server: `http://localhost:${PORT:-8787}`
- sandbox preview host: `http://localhost:${SANDBOX_PORT:-5174}`

Deck previews load from the sandbox origin via short-lived render tokens. The shell creates sessions through `/api/preview-sessions` and embeds `{sandboxOrigin}/render/{token}?parent={appOrigin}` in the preview iframe.

Optional env vars (see `.env.example`):

- `ARK_SANDBOX_ORIGIN` / `SANDBOX_PORT` — sandbox host origin (default `http://localhost:5174`)
- `ARK_APP_ORIGIN` — app shell origin used for parent/deck `postMessage` scoping (default `http://localhost:5173`)
- `VITE_ARK_PREVIEW_SRCDOC=true` — force legacy inline `srcDoc` preview instead of the sandbox host
- `ARK_THUMBNAIL_RENDERER=off` — disable sandbox-backed PNG thumbnails (clients keep `srcDoc` fallback)
- `ARK_CHROMIUM_PATH` — Chromium/Chrome binary for thumbnail rendering and browser smoke
- `ARK_CHROMIUM_NO_SANDBOX=true` — always launch thumbnail Chromium with `--no-sandbox` (skip sandboxed probe; also `1`/`yes`/`on`)
- `ARK_THUMBNAIL_CACHE_DIR` — thumbnail PNG cache directory (default `data/thumbnails`)

To use a custom API port, set `PORT` in `.env` or run `PORT=9000 pnpm dev`, then open the app on port `5173` — not the API port directly.

## Production API + sandbox host

After building the client (`pnpm build`), serve the static app however you prefer (for example `pnpm preview` or your CDN) and run the backend processes:

```bash
pnpm start
```

This starts the API server and sandbox preview host together. Set `PORT`, `SANDBOX_PORT`, `ARK_APP_ORIGIN`, and `ARK_SANDBOX_ORIGIN` to match your deployed origins before starting. For sandbox-rendered thumbnails, install Chromium/Chrome on the API host (or set `ARK_CHROMIUM_PATH`); without it the shell falls back to script-stripped `srcDoc` thumbnails. See [docs/thumbnails.md](docs/thumbnails.md).

## Checks

Run these locally before opening a pull request (CI runs the same gates on `ubuntu-latest`):

```bash
pnpm lockfile:check
pnpm lint          # includes frontend/backend import boundary checks
pnpm format:check
pnpm audit
pnpm build
pnpm test
pnpm smoke:plain-css   # Browser smoke selected for runtime-affecting PRs
# Optional fuller local suites:
# pnpm smoke:browser           # plain + Reveal + full-JS + manual-edit
# pnpm smoke:browser:extended  # Reveal + full-JS + manual-edit + thumbnails
# pnpm test:live-chromium      # API-level Chromium thumbnail renderer
```

Import boundaries between `apps/*` and `packages/*` are enforced by ESLint (`eslint.config.js`). See [docs/architecture-boundaries.md](docs/architecture-boundaries.md) for allowed dependency directions.

`pnpm test` runs Vitest in two phases: **packages in parallel** (`pnpm --parallel --filter './packages/**' test`, ignoring the package dependency graph so suites overlap), then **apps serially** (`--workspace-concurrency=1`). Running `apps/api` and `apps/web` together overloads a single runner and causes Vitest timeouts — keep apps serial unless those suites get much lighter. `pnpm test:affected --base <sha>` uses pnpm's workspace dependency graph to run changed workspaces and all downstream dependents with the same package/app concurrency policy. Live Chromium thumbnail coverage remains separate (`pnpm test:live-chromium`). Coverage includes hostile deck and manual editor security fixtures (`apps/web/src/test/sandbox-fixtures.test.ts`, `apps/web/src/test/editor-security-fixtures.test.ts`). Browser smoke tests use headless Chromium via CDP. Set `ARK_CHROMIUM_PATH` if Chromium is not on your `PATH` (CI uses `/usr/bin/google-chrome`).

### CI selection policy

The required `quality`, `build`, `test`, and `smoke` checks always report a result, but ordinary pull requests only perform work relevant to their complete base-to-head diff:

| Change                                                                         | Build                | Unit tests                      | Plain CSS smoke |
| ------------------------------------------------------------------------------ | -------------------- | ------------------------------- | --------------- |
| Documentation, agent guides, benchmarks                                        | Skip                 | Skip                            | Skip            |
| Workspace test files only                                                      | Full typecheck/build | Changed workspaces + dependents | Skip            |
| Runtime workspace code                                                         | Full typecheck/build | Changed workspaces + dependents | Run             |
| Fixtures, runtimes, dependency manifests, CI/test configuration, unknown paths | Full                 | Full                            | Run             |

`quality` always runs for normal PR updates. Scope decisions and selected workspaces are written to the Actions job summary. Unknown paths fall back to full validation; classifier test or execution failures fail the required checks closed.

Every `main` push and manual workflow dispatch runs comprehensive validation: the full unit suite, live Chromium renderer tests, plain-CSS smoke, Reveal, full-JS bridge, manual-edit, and thumbnail smokes. Pull requests never run the non-required live-Chromium or extended browser jobs; high-risk PR inputs still select the full unit suite and required plain-CSS smoke. Because this repository cannot use GitHub Merge Queue, comprehensive browser coverage is a post-merge guarantee and may temporarily make `main` red when it catches a regression.

Format before pushing substantive changes:

```bash
pnpm format
```

GitHub Actions (`.github/workflows/ci.yml`) consolidates cheap static checks into one `quality` job and skips setup for irrelevant PR gates. Superseded runs are cancelled, browser retries are capped at three attempts, and all third-party actions are commit-pinned. No API keys or `.env` file are required for CI.
