# Ark

Ark is an AI-first presentation builder. Describe a deck in plain language, and Ark generates a portable single-page HTML presentation that previews in an iframe and can be downloaded as `.html`.

## Setup

```bash
pnpm install
cp .env.example .env
```

Add your OpenAI API key to `.env`:

```env
OPENAI_API_KEY=your_key_here
```

### Choosing a model

You can pick the model in two ways:

1. **In the UI (recommended)** — Open the chat panel and use the model dropdown in the prompt input footer. Ark scans your OpenAI account for available chat models on load; use the refresh button to re-scan. Your choice is saved in the browser.

2. **In `.env` (default fallback)** — Set `OPENAI_MODEL` to choose the server default when no model is saved in the UI yet:

```env
OPENAI_MODEL=gpt-4o-mini
```

Optional API port (Vite proxies `/api` to this by default):

```env
PORT=8787
```

Only `OPENAI_API_KEY` is required. `OPENAI_MODEL` and `PORT` are optional.

### API key errors

If `.env` is missing `OPENAI_API_KEY`, still has the placeholder value, or the key is rejected by OpenAI, the chat panel shows a clear error and disables generation until you fix it. After updating `.env`, restart `pnpm dev` and use the model refresh button in chat if needed.

## Development

```bash
pnpm dev
```

This starts both:

- Vite app: `http://localhost:5173`
- local API server: `http://localhost:8787`

## Checks

```bash
pnpm lint
pnpm build
```
