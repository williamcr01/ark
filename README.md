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

1. **In the UI (recommended)** — Open the chat panel and use the model dropdown in the prompt input footer. Ark scans each configured provider for available models on load; use the refresh button to re-scan. Your choice is saved in the browser.

2. **In `.env` (default fallback)** — Set `ARK_DEFAULT_MODEL` using `provider:model-id` syntax when no model is saved in the UI yet:

```env
ARK_DEFAULT_MODEL=anthropic:claude-sonnet-4-20250514
```

`OPENAI_MODEL` is still supported as a legacy OpenAI-only default.

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

| Provider | Env var                        | Model scan source              |
| -------- | ------------------------------ | ------------------------------ |
| OpenAI   | `OPENAI_API_KEY`               | OpenAI `/v1/models`            |
| Claude   | `ANTHROPIC_API_KEY`            | Anthropic `/v1/models`         |
| Gemini   | `GOOGLE_GENERATIVE_AI_API_KEY` | Google Generative Language API |

### API key errors

If `.env` has no provider keys, still has placeholder values, or a key is rejected, the chat panel shows a clear error and disables generation until you fix it. If one provider fails to scan but others succeed, Ark still lists the working models and shows a warning for the failed provider. After updating `.env`, restart `pnpm dev` and use the model refresh button in chat if needed.

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
pnpm smoke:browser
```

Import boundaries between `apps/*` and `packages/*` are enforced by ESLint (`eslint.config.js`). See [docs/architecture-boundaries.md](docs/architecture-boundaries.md) for allowed dependency directions.

`pnpm test` includes Vitest unit/integration coverage plus hostile deck and manual editor security fixtures (`apps/web/src/test/sandbox-fixtures.test.ts`, `apps/web/src/test/editor-security-fixtures.test.ts`). Browser smoke tests use headless Chromium via CDP and cover the no-key core workflow: upload HTML, slide navigation, thumbnail strip, and Present mode for both plain CSS and approved Reveal decks. `pnpm smoke:thumbnails` separately exercises sandbox-rendered PNG thumbnails with the renderer enabled. Set `ARK_CHROMIUM_PATH` if Chromium is not on your `PATH` (CI uses `/usr/bin/google-chrome`).

Format before pushing substantive changes:

```bash
pnpm format
```

Pull requests and pushes to `main` run the same checks in GitHub Actions on an `ubuntu-latest` runner (see `.github/workflows/ci.yml`). No API keys or `.env` file are required for CI.
