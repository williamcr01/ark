# Renderer benchmark (local)

Local production-build harness for measuring Ark main-preview and thumbnail
latency. This is intentionally **not** a CI gate yet.

## Quick start

```bash
# Default: production web bundle, 10 measured iterations + 1 warmup
pnpm benchmark:renderer

# Faster smoke of the harness itself
pnpm benchmark:renderer -- --iterations 1 --warmup 0 --fixtures plain-css --scenarios upload_warm

# Compare two runs on the same machine
pnpm benchmark:renderer -- --output artifacts/renderer-benchmarks/before.json
# ... make changes ...
pnpm benchmark:renderer -- --compare artifacts/renderer-benchmarks/before.json
```

## What it measures

User-visible timings from the instant before HTML upload:

| Metric                         | Meaning                                               |
| ------------------------------ | ----------------------------------------------------- |
| `shell_ready_ms`               | Deck title + slide counter appear in the shell        |
| `preview_active_slide_ms`      | Active slide content is visible in the sandbox iframe |
| `thumb_png_visible_decoded_ms` | Initially visible PNG thumbnails are decoded          |
| `preview_session_count`        | `POST /api/preview-sessions` calls                    |
| `status_request_count`         | Thumbnail status requests                             |
| `mounted_iframe_peak`          | Peak fallback thumbnail iframe count                  |
| `long_task_total_ms`           | Accumulated long tasks during the upload flow         |

JSON output also includes DOMParser counts, fallback iframe timing, and correlated
API events such as `thumbnail.render.succeeded`.

## Scenarios

| Scenario      | Behavior                                                                  |
| ------------- | ------------------------------------------------------------------------- |
| `upload_cold` | Fresh API/sandbox/web stack, empty thumbnail cache, new Chromium profile  |
| `upload_warm` | Reuses servers (warm Chromium pool) and reloads the shell between uploads |

`--extended` adds generated 20-slide plain/Reveal fixtures and a large-inline-style deck.

## Distortion checklist

- Prefer `--web-mode production` (default). Development/StrictMode can inflate work.
- Run parent and candidate on the **same host** with the same iteration count.
- Do not run against an already-running `pnpm dev` stack; the harness allocates isolated ports.
- Keep edit mode off; edit mode disables thumbnail polling.
- Treat gains inside run-to-run MAD/noise as inconclusive.

## Output

Runs write JSON under `artifacts/renderer-benchmarks/` (gitignored) unless
`--output` is provided. Failures also write browser-smoke style artifacts.
