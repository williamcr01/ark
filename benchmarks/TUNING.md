# Renderer benchmark tuning notes

Experiments were run on the same Cursor Cloud host with the production web bundle.

## Queue concurrency

Primary metric: `final_version_thumb_ready_ms` — time from the last burst PUT
until `GET /api/decks/:id/thumbnails?versionId=…` returns `ready` for that
version. This deliberately excludes shell reload/decode time.

Command template:

```bash
pnpm benchmark:renderer -- --iterations 5 --warmup 1 --fixtures plain-css --scenarios rapid_version_burst --queue-concurrency <N> --output artifacts/renderer-benchmarks/concurrency-<N>.json
```

### Superseded (2026-07-11, flawed harness)

An earlier pair used shell-reload + soft decode completion and reported
concurrency 2 slightly slower than 1 (~408ms vs ~424ms median). That result is
**not actionable**: the timer included full page reload and could complete after
a single decoded thumbnail.

### Current (API-ready metric)

Same host, production web bundle, `plain-css` / `rapid_version_burst`,
5 iterations + 1 warmup each. Artifacts (gitignored):
`artifacts/renderer-benchmarks/concurrency-{1,2,3,4}.json`.

| Queue concurrency | median | p90   | MAD  | `burst_submit_ms` median | `thumbnail_render_count` median | Notes                                         |
| ----------------- | ------ | ----- | ---- | ------------------------ | ------------------------------- | --------------------------------------------- |
| 1                 | 284.4  | 324.3 | 20.4 | 262.8                    | 2                               | Fewest renders; best median and p90           |
| 2                 | 339.0  | 398.2 | 27.0 | 233.7                    | 3                               | ~19% slower median vs 1 (beyond MAD)          |
| 3                 | 377.9  | 447.2 | 18.8 | 253.6                    | 4                               | Worse than 2; more superseded work runs       |
| 4                 | 415.6  | 454.4 | 18.5 | 256.6                    | 5                               | Slowest; render count scales with concurrency |

Decision: keep default concurrency **1**. Both median and p90 of
`final_version_thumb_ready_ms` are best at 1, and the gap vs 2 (~55ms median,
~74ms p90) is larger than concurrency-1 MAD (~20ms) and well above 5%. Higher
concurrency increases `thumbnail_render_count` (2→3→4→5): more mid-burst
versions start rendering before supersede/cancel can win, so the final version
waits behind parallel Chromium work. On ties we would prefer lower concurrency
anyway; here 1 is strictly best, so `THUMBNAIL_QUEUE_CONCURRENCY` stays at 1.

## Settle delay

Command:

```bash
pnpm benchmark:settle-delta
```

Artifact:
`artifacts/renderer-benchmarks/settle-delta-2026-07-11T21-51-10.354Z.json`

| Fixture            | Settle values byte-identical to 120ms reference |
| ------------------ | ----------------------------------------------- |
| `plain-css`        | 0ms, 40ms, 80ms, 120ms                          |
| `reveal-registry`  | 0ms, 40ms, 80ms, 120ms                          |
| `reveal-fragments` | 0ms, 40ms, 80ms, 120ms                          |

Decision: lower `THUMBNAIL_SETTLE_MS` from 120ms to 80ms, then to **40ms**.
The tested lower values were byte-identical on these fixtures; 40ms keeps a
small fallback budget around the adaptive font/image/frame settle path while
cutting up to ~40ms per captured slide vs the prior 80ms default. This is
**not** a broad visual QA pass; fixtures are small and the `reveal-fragments`
case only embeds a fragment span (it does not step fragments).

## 2026-07-12 renderer hot-path optimizations

Same host, production web bundle. Primary signal remains
`final_version_thumb_ready_ms` on `rapid_version_burst` (API ready after last
PUT). Supporting signals: `thumbnail_render_count`, per-render
`durationMs`, upload/reload shell metrics.

Changes shipped:

1. **Abort in-flight obsolete warms** — a newer background warm for the same
   deck aborts the running Chromium capture via `AbortSignal`, so mid-burst
   versions stop blocking the final version (was: only queued jobs discarded).
2. **Reuse Chromium tabs** — successful renders return the page to a one-slot
   pool (`about:blank` + cleared CDP listeners) instead of
   create/dispose every job.
3. **Precompute thumbnail preview HTML** at session create so
   `GET /api/thumbnail-render/:token` does not rebuild JSDOM on the navigation
   critical path.
4. **Tighter CDP polls** (ready/goto 10ms, settle 5ms), **skip goto** when
   already on the target slide, **single rAF** settle, **settleMs=40**,
   **defer `cache.cleanup()`** off the ready path, pass `slideCount` to skip a
   redundant parse, and reduce client `PENDING_REPOLL_MS` 250→50.

### Measured results (same host, production web bundle)

Paired 3-iteration compare (`baseline.json` @ `5f46aac` → `optimized.json` @
`64399b5`), fixtures `plain-css` + `reveal-registry`:

| Scenario / fixture                      | Metric                         | Before median | After median |    Delta |
| --------------------------------------- | ------------------------------ | ------------: | -----------: | -------: |
| `rapid_version_burst` / plain-css       | `final_version_thumb_ready_ms` |         300.7 |        135.0 | **-55%** |
| `rapid_version_burst` / reveal-registry | `final_version_thumb_ready_ms` |         373.8 |        174.9 | **-53%** |
| `rapid_version_burst` / plain-css       | `thumbnail_render_count`       |             2 |            1 | **-50%** |
| `rapid_version_burst` / reveal-registry | `thumbnail_render_count`       |             2 |            1 | **-50%** |
| `rapid_version_burst` / plain-css       | render `durationMs` (sample)   |          ~251 |          ~97 | **-61%** |
| `rapid_version_burst` / reveal-registry | render `durationMs` (sample)   |          ~303 |         ~137 | **-55%** |

Confirmatory 5-iteration burst-only (`optimized-burst5.json`): render count stays
at **1**; `final_version_thumb_ready_ms` median **221.9** (plain) / **208.6**
(reveal) — still well below the 3-iter baseline (~301 / ~374). Per-render
`durationMs` median ~139 / ~172.

Shell-visible upload/reload metrics moved within run-to-run MAD and are not
treated as regressions. `pnpm benchmark:settle-delta` still reports
byte-identical PNGs at 0/40/80/120ms for plain-css, reveal-registry, and
reveal-fragments after the single-rAF + 40ms settle change.

## 2026-07-12 preview path optimizations

Same host, production web bundle. Primary signals:
`shell_ready_ms` and `preview_active_slide_ms` on `upload_warm` +
`deck_reload_warm`.

Changes shipped:

1. **Optimistic title** on persist (unlock chrome before the save round-trip).
2. **Early active-deck apply** on boot — apply `fetchDeck` as soon as it
   resolves; validate against `listDecks` afterward; clear loading once the
   deck applies.
3. **Lazy thumbnail srcDoc builder** — do not build strip fallback HTML on the
   main preview path.
4. **Pre-activate css-only slide 0** before the nav script runs.
5. **Fast handshake inject** on preview HTML cache hits (string replace).
6. **Preview HTML cache pipeline v2**; **session content-hash dedupe**;
   client coalesce **300→100ms**.
7. **Deferred-strip race fix** — keep the initial empty→slides parse eager so
   the strip mounts with the slide counter; collect preview metrics without
   waiting on the strip; do not toggle the strip closed when it is still
   unmounted.

### Measured results

Paired compare (`preview-baseline.json` @ `66f28a3` →
`preview-optimized-fixed.json` @ `98a760a`), 5 iterations + 1 warmup,
fixtures `plain-css` + `reveal-registry`. Compare: **PASS** (no 15s outliers).

| Scenario / fixture                   | Metric                    | Before median | After median |    Delta |
| ------------------------------------ | ------------------------- | ------------: | -----------: | -------: |
| `upload_warm` / plain-css            | `preview_active_slide_ms` |         205.0 |         83.8 | **-59%** |
| `upload_warm` / reveal-registry      | `preview_active_slide_ms` |         197.0 |        127.8 | **-35%** |
| `deck_reload_warm` / plain-css       | `preview_active_slide_ms` |         154.0 |        137.4 | **-11%** |
| `deck_reload_warm` / reveal-registry | `preview_active_slide_ms` |         151.0 |        128.5 | **-15%** |

Command:

```bash
pnpm benchmark:renderer -- --iterations 5 --warmup 1 --fixtures plain-css,reveal-registry --scenarios upload_warm,deck_reload_warm --compare artifacts/renderer-benchmarks/preview-baseline.json
```
