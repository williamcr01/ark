# Approved deck runtimes

Ark decks are single HTML files. Most decks use plain CSS and optional inline scripts. When a deck needs a presentation library, it must use an **approved runtime** — a pinned, vendored library that Ark serves from its own origin.

This document describes the registry model, security rules, validation, and how to add future runtimes. For reveal.js authoring details, see [reveal-runtime.md](./reveal-runtime.md).

## What is an approved runtime?

An approved runtime is a library version listed in `runtimes/manifest.json` with:

- Pinned assets under `runtimes/<id>/<version>/`
- SHA-256 checksums and byte sizes for every asset
- Allowed marker values (`data-ark-runtime`, `data-ark-deck`, `data-ark-runtime-lib`, etc.)
- Required asset paths that decks must reference
- Preview policy (`previewMode`, `allowsDeckScripts`, `allowedGlobals`)

Today the registry contains one runtime: **reveal.js 5.1.0**. The same model is intended for future libraries (charts, animation, etc.) without reopening arbitrary CDN access.

## Why are arbitrary CDNs still blocked?

Preview iframes are sandboxed and receive a strict Content-Security-Policy that blocks external `http://` and `https://` resources. That applies even when a CDN URL points at the same library version as an approved runtime.

Blocking arbitrary CDNs:

- Prevents supply-chain and MITM risk from third-party hosts
- Keeps preview network-isolated (`connect-src 'none'`)
- Ensures only checksum-verified assets from `runtimes/` can load in preview
- Makes validation deterministic: a deck either uses approved `/api/runtimes/...` URLs or fails upload/save/generation

**CDN reveal.js URLs are invalid** even if they match reveal.js 5.1.0. Use `/api/runtimes/reveal.js/5.1.0/...` instead.

Approved runtime scripts are **not** the same as arbitrary user deck scripts. Custom deck JavaScript still requires explicit full-JS markers (`data-ark-deck="nav"` or `data-ark-preview="full-js"`) and follows the bridge protocol in [deck-bridge.md](./deck-bridge.md).

The optional asset proxy (`GET /api/deck-assets?url=...`) is separate: it fetches allowlisted remote assets server-side when `ARK_DECK_ASSET_ALLOWLIST` is set. It does not replace approved runtime libraries.

## Registry API

### `GET /api/runtimes`

Returns JSON metadata for all approved runtimes:

```json
{
  "schemaVersion": 1,
  "runtimes": [
    {
      "id": "reveal.js",
      "version": "5.1.0",
      "runtimeMode": "reveal",
      "previewMode": "css-only",
      "allowsDeckScripts": false,
      "assets": [
        {
          "path": "reveal.js",
          "kind": "script",
          "url": "/api/runtimes/reveal.js/5.1.0/reveal.js",
          "sha256": "...",
          "size": 158882
        }
      ]
    }
  ]
}
```

Use this endpoint to discover supported versions, asset paths, and checksums without reading source.

### `GET /api/runtimes/:runtimeId/:version/:assetPath`

Serves a single approved asset from disk. Responses include:

- Correct `Content-Type` for scripts, stylesheets, and fonts
- `Cache-Control: public, max-age=31536000, immutable`
- `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin` (for sandbox preview)
- `X-Checksum-Sha256` matching the manifest entry

Unknown runtime IDs, versions, or asset paths return **404**.

## Required deck markers

Runtime library markers go on `<html>` (or `<body>`):

| Attribute                  | Purpose                                 |
| -------------------------- | --------------------------------------- |
| `data-ark-runtime`         | Runtime family (`reveal` for reveal.js) |
| `data-ark-runtime-lib`     | Registry library id (`reveal.js`)       |
| `data-ark-runtime-version` | Pinned version (`5.1.0`)                |

For reveal.js, `data-ark-deck="reveal"` is also accepted as an alternate marker. All three library markers should be set together for validation and agent generation.

Custom full-JS decks use built-in markers instead:

| Attribute          | Value       | Purpose                                |
| ------------------ | ----------- | -------------------------------------- |
| `data-ark-deck`    | `nav`       | Deck owns navigation via bridge events |
| `data-ark-preview` | `full-js`   | Run deck scripts without nav ownership |
| `data-ark-runtime` | `custom-js` | Explicit custom-js runtime mode        |

Invalid marker values are blocking validation errors.

## Asset URL rules

Deck source HTML references runtime assets with root-relative URLs:

```
/api/runtimes/<runtimeId>/<version>/<assetPath>
```

Example:

```
/api/runtimes/reveal.js/5.1.0/reveal.js
/api/runtimes/reveal.js/5.1.0/reveal.css
/api/runtimes/reveal.js/5.1.0/theme/white.css
```

Validation checks:

1. Every `/api/runtimes/...` reference must match an entry in `runtimes/manifest.json`.
2. When `data-ark-runtime-lib` and `data-ark-runtime-version` are set, every runtime asset URL must use that exact id and version.
3. Required assets from the manifest must all be referenced (for reveal.js: `reveal.css`, `theme/white.css`, `reveal.js`).

Optional assets (e.g. `reset.css`, theme fonts) may be referenced when listed in the manifest.

## Preview behavior

Preview processing lives in `packages/deck-core/deck-preview-html.ts` and `apps/sandbox/render-preview-html.ts`.

| Deck type                                | Preview mode             | What runs                                                 |
| ---------------------------------------- | ------------------------ | --------------------------------------------------------- |
| Plain CSS (`section.slide`)              | CSS-only                 | Scripts stripped; Ark injects CSS nav shim                |
| Custom full-JS (`data-ark-deck="nav"`)   | Full-JS                  | Deck scripts kept; Ark injects bridge                     |
| Reveal with approved assets + markers    | Full-JS (reveal adapter) | Approved `reveal.js` kept; Ark injects reveal nav adapter |
| Reveal structure without approved assets | CSS-only                 | Scripts stripped; CSS shim navigates static sections      |

For approved reveal decks, preview **absolutizes** `/api/runtimes/...` URLs to the app origin (e.g. `http://localhost:5173/api/runtimes/...`) so the sandbox iframe can fetch assets from the API while the deck document stays on the sandbox origin. Deck source on disk still uses root-relative `/api/runtimes/...` paths.

Thumbnails always strip scripts (`sandbox=""`). Approved reveal CSS is inlined into thumbnail `srcDoc` when available. See [reveal-runtime.md](./reveal-runtime.md) for thumbnail limitations.

Main preview and Present mode load processed HTML from the sandbox host (default `http://localhost:5174`) via short-lived render tokens. Set `VITE_ARK_PREVIEW_SRCDOC=true` to use legacy inline `srcDoc` preview.

## Security constraints

- **No external URLs** in deck HTML for scripts, stylesheets, fonts, or images (`external_url` validation error).
- **Sandboxed preview**: `sandbox="allow-scripts"` without `allow-same-origin`.
- **Strict CSP** injected into preview and thumbnails: `connect-src 'none'`, no external `default-src`.
- **Thumbnails**: scriptless (`sandbox=""`); inline handlers stripped.
- **Approved runtime scripts** load only from `/api/runtimes/...`; the registry is the allowlist.
- **User deck scripts** run only with explicit full-JS markers; reveal runtime decks do not allow additional deck scripts (`allowsDeckScripts: false` in manifest).

## Agent generation

The deck agent system prompt in `apps/api/deck-agent.ts` includes a registry summary built from `buildRuntimeRegistryPromptSection()`. Agents must:

- Prefer plain Ark decks unless reveal.js is requested or clearly needed
- Use exact markers and `/api/runtimes/...` URLs from the registry
- Never emit CDN URLs for runtime libraries
- Avoid reveal plugins unless they are added to the registry
- Keep deck-specific CSS inline in `<style>` tags

See [reveal-runtime.md](./reveal-runtime.md) for reveal-specific agent rules.

## Adding a future runtime

Minimum checklist for contributors:

1. **Vendor assets** — Add pinned files under `runtimes/<id>/<version>/`.
2. **Manifest entry** — Add id, version, markers, `requiredAssets`, and per-file `sha256` + `size` to `runtimes/manifest.json`.
3. **Registry types** — Extend `ApprovedRuntimeEntry` in `packages/runtime-registry/deck-runtime-registry.ts` if new fields are needed.
4. **Validation tests** — Cover marker checks, required assets, version mismatch, and CDN rejection (`packages/deck-core/deck-validate.test.ts`, `packages/runtime-registry/deck-runtime-registry.test.ts`).
5. **Server route tests** — List and serve assets (`apps/api/deck-runtimes.test.ts`).
6. **Preview tests** — Asset preservation, CSP, adapter injection (`apps/sandbox/render-preview-html.test.ts`, `apps/web/src/lib/deck-preview.test.ts`).
7. **Thumbnail tests** — CSS inlining and slide selection if the runtime affects sidebar previews (`apps/web/src/lib/deck-slides.test.ts`).
8. **Smoke test** — Add or extend `scripts/smoke-reveal-runtime.ts` pattern for end-to-end preview if the runtime runs scripts.
9. **Agent prompt** — Registry section updates automatically from manifest; add runtime-specific guidance if needed.
10. **Documentation** — Add or update a runtime guide under `docs/` and link from this file.

## Related issues and PRs

Staged reveal.js support:

- [#88](https://github.com/williamcr01/ark/issues/88) — Runtime registry foundation
- [#93](https://github.com/williamcr01/ark/issues/93) — Approved runtime asset rendering in preview
- [#94](https://github.com/williamcr01/ark/issues/94) — First-class reveal.js navigation
- [#95](https://github.com/williamcr01/ark/issues/95) — Reveal.js thumbnail rendering

Implementation references:

- `runtimes/manifest.json` — Source of truth for approved assets
- `packages/runtime-registry/deck-runtime-registry.ts` — Registry lookup and validation helpers
- `apps/api/deck-runtimes.ts` — `/api/runtimes` route handlers
- `packages/deck-core/deck-validate.ts` — Portable deck validation (`validateDeckHtml`); browser wrapper in `apps/web/src/lib/deck-validate.ts`, server wrapper in `apps/api/deck-validate.ts`
- `docs/deck-bridge.md` — Parent ↔ iframe protocol including reveal adapter
