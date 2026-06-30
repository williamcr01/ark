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

### Supported providers

| Provider | Env var | Model scan source |
|----------|---------|-------------------|
| OpenAI | `OPENAI_API_KEY` | OpenAI `/v1/models` |
| Claude | `ANTHROPIC_API_KEY` | Anthropic `/v1/models` |
| Gemini | `GOOGLE_GENERATIVE_AI_API_KEY` | Google Generative Language API |

### API key errors

If `.env` has no provider keys, still has placeholder values, or a key is rejected, the chat panel shows a clear error and disables generation until you fix it. If one provider fails to scan but others succeed, Ark still lists the working models and shows a warning for the failed provider. After updating `.env`, restart `pnpm dev` and use the model refresh button in chat if needed.

## Development

```bash
pnpm dev
```

This starts both:

- Vite app: `http://localhost:5173` (proxies `/api` to the port below)
- local API server: `http://localhost:${PORT:-8787}`

To use a custom API port, set `PORT` in `.env` or run `PORT=9000 pnpm dev`, then open the app on port `5173` — not the API port directly.

## Checks

```bash
pnpm lint
pnpm build
pnpm test
```

Pull requests and pushes to `main` run the same checks in GitHub Actions on an `ubuntu-latest` runner (see `.github/workflows/ci.yml`). No API keys or `.env` file are required for CI.
