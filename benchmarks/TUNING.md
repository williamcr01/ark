# Renderer benchmark tuning notes

Experiments were run on the same Cursor Cloud host with the production web bundle.

## Queue concurrency

Command pair:

```bash
pnpm benchmark:renderer -- --iterations 5 --warmup 1 --fixtures plain-css --scenarios rapid_version_burst --queue-concurrency 1 --output artifacts/renderer-benchmarks/concurrency-1.json
pnpm benchmark:renderer -- --iterations 5 --warmup 1 --fixtures plain-css --scenarios rapid_version_burst --queue-concurrency 2 --output artifacts/renderer-benchmarks/concurrency-2.json
```

| Queue concurrency | `final_version_thumb_ready_ms` median | p90   | MAD  | Notes                 |
| ----------------- | ------------------------------------- | ----- | ---- | --------------------- |
| 1                 | 408.1ms                               | 508.2 | 13.8 | Baseline              |
| 2                 | 423.6ms                               | 525.3 | 19.2 | Slower median and p90 |

Decision: keep `THUMBNAIL_QUEUE_CONCURRENCY = 1`. Concurrency 2 did not clearly exceed noise; it regressed both median and p90 for the tested burst scenario.

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

Decision: lower `THUMBNAIL_SETTLE_MS` from 120ms to 80ms. The tested lower values were byte-identical, but 80ms is a conservative fallback that preserves some time budget around the adaptive font/image/frame settle path.
