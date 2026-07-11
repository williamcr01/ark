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

| Queue concurrency | `final_version_thumb_ready_ms` median | p90 | MAD | Notes                           |
| ----------------- | ------------------------------------- | --- | --- | ------------------------------- |
| _pending redo_    |                                       |     |     | Fill after proper 1/2/3/4 sweep |

Decision: _pending redo_.

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

Decision: lower `THUMBNAIL_SETTLE_MS` from 120ms to 80ms. The tested lower values
were byte-identical on these fixtures, but 80ms is a conservative fallback that
preserves some time budget around the adaptive font/image/frame settle path.
This is **not** a broad visual QA pass; fixtures are small and the
`reveal-fragments` case only embeds a fragment span (it does not step fragments).
