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

See PR notes / `artifacts/renderer-benchmarks/{baseline,optimized}.json` for
measured before/after on this host.
