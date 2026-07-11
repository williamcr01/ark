# Renderer benchmark (local)

Local production-build harness for measuring Ark main-preview and thumbnail
latency. This is intentionally **not** a CI gate yet.

## Quick start

```bash
# Default: production web bundle, 10 measured iterations + 1 warmup
pnpm benchmark:renderer

# Faster smoke of the harness itself
pnpm benchmark:renderer -- --iterations 1 --warmup 0 --fixtures plain-css --scenarios upload_warm

# Exercise version-burst thumbnail behavior with an explicit queue setting
pnpm benchmark:renderer -- --iterations 5 --warmup 1 --fixtures plain-css --scenarios rapid_version_burst --queue-concurrency 1

# Compare thumbnail settle PNG identity against the 120ms reference
pnpm benchmark:settle-delta

# Compare two runs on the same machine
pnpm benchmark:renderer -- --output artifacts/renderer-benchmarks/before.json
# ... make changes ...
pnpm benchmark:renderer -- --compare artifacts/renderer-benchmarks/before.json
```

## What it measures

User-visible timings from the instant before HTML upload:

| Metric                         | Meaning                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `shell_ready_ms`               | Deck title + slide counter appear in the shell                                                             |
| `preview_active_slide_ms`      | Active slide content is visible in the sandbox iframe                                                      |
| `thumb_png_visible_decoded_ms` | Initially visible PNG thumbnails are decoded                                                               |
| `final_version_thumb_ready_ms` | Time from last burst PUT until final-version thumbnail status is `ready` (API poll; excludes shell reload) |
| `burst_submit_ms`              | Time to submit sequential PUTs in `rapid_version_burst`                                                    |
| `thumbnail_render_count`       | API thumbnail render batches observed during the scenario                                                  |
| `preview_session_count`        | `POST /api/preview-sessions` calls                                                                         |
| `status_request_count`         | Thumbnail status requests                                                                                  |
| `mounted_iframe_peak`          | Peak fallback thumbnail iframe count                                                                       |
| `long_task_total_ms`           | Accumulated long tasks during the upload flow                                                              |

JSON output also includes DOMParser counts, fallback iframe timing, and correlated
API events such as `thumbnail.render.succeeded`.

## Scenarios

| Scenario              | Behavior                                                                                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload_cold`         | Fresh API/sandbox/web stack, empty thumbnail cache, new Chromium profile                                                                                                                                          |
| `upload_warm`         | Reuses servers (warm Chromium pool) and reloads the shell between uploads                                                                                                                                         |
| `deck_reload_warm`    | Uploads once, verifies warm-cache reloads decode PNGs with zero thumbnail renders                                                                                                                                 |
| `rapid_version_burst` | Uploads once, submits a sequential PUT burst, measures API thumbnail readiness for the final version, then best-effort reloads the shell (PNG decode is secondary; incomplete shell decode does not fail the run) |

`--extended` adds generated 20-slide plain/Reveal fixtures and a large-inline-style deck.

## Tuning flags

| Flag                      | Meaning                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `--burst-count <n>`       | Number of sequential PUTs for `rapid_version_burst` (default 6)            |
| `--queue-concurrency <n>` | Sets `ARK_THUMBNAIL_QUEUE_CONCURRENCY` for the benchmark stack (default 1) |
| `--settle-ms <n>`         | Sets `ARK_THUMBNAIL_SETTLE_MS` for the benchmark stack                     |

## Distortion checklist

- Prefer `--web-mode production` (default). Development/StrictMode can inflate work.
- Run parent and candidate on the **same host** with the same iteration count.
- Do not run against an already-running `pnpm dev` stack; the harness allocates isolated ports.
- Keep edit mode off; edit mode disables thumbnail polling.
- Treat gains inside run-to-run MAD/noise as inconclusive.

## Output

Runs write JSON under `artifacts/renderer-benchmarks/` (gitignored) unless
`--output` is provided. Failures also write browser-smoke style artifacts.

See [TUNING.md](./TUNING.md) for local queue-concurrency and settle-delay findings.
