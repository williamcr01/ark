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
OPENAI_MODEL=gpt-4o-mini
PORT=8787
```

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
