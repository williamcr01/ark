# Chart.js runtime authoring

Ark supports [Chart.js](https://www.chartjs.org/) **4.5.1** through the approved runtime registry. Decks reference Ark-served assets and runtime markers; interactive charts run in full-JS preview under Ark's existing CSP.

General registry rules: [runtimes.md](./runtimes.md). Bridge protocol: [deck-bridge.md](./deck-bridge.md).

## When to use Chart.js

- Prefer **inline SVG** for simple static charts (single-series bar comparisons, sparklines, icons, small callouts). SVG stays CSS-only, patches cleanly, and renders in script-stripped thumbnails.
- Use **Chart.js** when interactivity, tooltips, legends, or multi-series data warrant a library.
- Do **not** make Chart.js the default for every deck.
- Do **not** use CDN URLs. Only `/api/runtimes/chart.js/4.5.1/...` is approved.

## Supported version

| Field         | Value                                     |
| ------------- | ----------------------------------------- |
| Registry id   | `chart.js`                                |
| Version       | `4.5.1`                                   |
| Source        | https://github.com/chartjs/Chart.js (MIT) |
| Vendored path | `runtimes/chart.js/4.5.1/`                |
| Asset         | `chart.umd.min.js` (UMD build, ~200 KB)   |
| Preview mode  | Full-JS (`data-ark-preview="full-js"`)    |

Only this version is approved. CDN Chart.js URLs fail validation even when the version matches.

## Supported chart types (v1)

`bar`, `line`, `pie`, `doughnut`, `radar`, `scatter`.

Custom partial bundles / tree-shaking are out of scope for v1 — use the full UMD asset.

## Required markers

Set on `<html>`:

```html
<html
  lang="en"
  data-ark-preview="full-js"
  data-ark-runtime="chart"
  data-ark-runtime-lib="chart.js"
  data-ark-runtime-version="4.5.1"
></html>
```

| Attribute                  | Required value | Notes                                             |
| -------------------------- | -------------- | ------------------------------------------------- |
| `data-ark-preview`         | `full-js`      | Runs deck scripts (Chart.js + inline init)        |
| `data-ark-runtime`         | `chart`        | Identifies chart runtime family                   |
| `data-ark-runtime-lib`     | `chart.js`     | Must match manifest `id`                          |
| `data-ark-runtime-version` | `4.5.1`        | Must match manifest `version` and every asset URL |

Do **not** use `data-ark-deck="nav"` unless the deck also owns slide navigation via the bridge protocol. Chart-only slides typically use `data-ark-preview="full-js"` and keep plain `section.slide` structure.

## Required assets

| Kind    | URL                                             |
| ------- | ----------------------------------------------- |
| Core JS | `/api/runtimes/chart.js/4.5.1/chart.umd.min.js` |

## Minimal deck skeleton

Copy-paste starting point (also available as `test/fixtures/chart-registry-deck.html`):

```html
<!doctype html>
<html
  lang="en"
  data-ark-preview="full-js"
  data-ark-runtime="chart"
  data-ark-runtime-lib="chart.js"
  data-ark-runtime-version="4.5.1"
>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chart Deck</title>
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
      }
      section.slide {
        display: none;
        box-sizing: border-box;
        width: 100vw;
        height: 100vh;
        padding: 4vh 6vw;
      }
      section.slide.active {
        display: flex;
        flex-direction: column;
      }
      .chart-wrap {
        flex: 1;
        min-height: 0;
        position: relative;
      }
      canvas {
        width: 100% !important;
        height: 100% !important;
      }
    </style>
  </head>
  <body>
    <section class="slide active">
      <h1>Quarterly revenue</h1>
      <div class="chart-wrap">
        <canvas id="revenueChart" role="img" aria-label="Bar chart"></canvas>
      </div>
    </section>
    <script src="/api/runtimes/chart.js/4.5.1/chart.umd.min.js"></script>
    <script>
      new Chart(document.getElementById('revenueChart'), {
        type: 'bar',
        data: {
          labels: ['Q1', 'Q2', 'Q3', 'Q4'],
          datasets: [{ label: 'Revenue', data: [4.2, 5.1, 4.8, 6.3] }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
        },
      })
    </script>
  </body>
</html>
```

Guidance:

- One `<canvas>` per chart (or per chart region).
- Inline `labels` / `datasets` JSON from user-provided data — no CSV parsing pipeline.
- Use `responsive: true`, `maintainAspectRatio: false`, and `animation: false` so charts fill 16:9 slide regions and thumbnail PNGs capture fully drawn canvases.
- Prefer `addEventListener` / deferred init over inline HTML event handlers.

## Preview behavior

- Chart decks use **full-JS** preview: Ark keeps deck scripts and injects the bridge (`data-ark-preview-bridge`).
- Approved Chart.js URLs are absolutized to the app origin so the sandbox iframe can load them.
- CSP allows `'unsafe-inline'` scripts plus the pinned Chart.js asset; `connect-src 'none'` still blocks network fetches from the deck.
- There is no Chart.js-specific navigation adapter (unlike reveal.js). Plain `section.slide` decks that need shell-driven navigation should listen for `ark:deck-goto` / dispatch `ark:deck-slide-change` per [deck-bridge.md](./deck-bridge.md).

## Thumbnails

Script-stripped thumbnail fallbacks **do not render live Chart.js canvases**. Acceptable v1 behavior:

- Electron-rendered PNG thumbnails capture the painted canvas after scripts run.
- `srcDoc` fallback shows empty/blank chart regions — prefer SVG for decks that must look correct in the scriptless strip, or accept the blank canvas until capture completes.

Coordinate deeper server-side chart fidelity with [#33](https://github.com/williamcr01/ark/issues/33) if needed.

## Export / download

Zip packaging of runtime assets ([#34](https://github.com/williamcr01/ark/issues/34)) is not implemented yet. Interim behavior:

| Download variant | Chart.js assets                                                        |
| ---------------- | ---------------------------------------------------------------------- |
| **Original**     | HTML keeps `/api/runtimes/chart.js/4.5.1/...` URLs (requires Ark host) |
| **Sanitized**    | Scripts stripped — charts will not run offline                         |

Until zip export lands, offline sharing needs either Ark to serve `/api/runtimes/...` or a manual copy of vendored files from `runtimes/chart.js/4.5.1/`.

## Agent rules

Model-facing Chart.js instructions live in [`agent-guides/20-chart-js.md`](../agent-guides/20-chart-js.md) (always appended to the deck agent system prompt). Live registry URLs still come from `buildRuntimeRegistryPromptSection()` in `packages/agent/agent.ts`.

1. Prefer inline SVG for simple static charts.
2. Use Chart.js only when interactivity / multi-series warrants it.
3. Always set the four markers above and the pinned `/api/runtimes/chart.js/4.5.1/chart.umd.min.js` URL.
4. Never emit CDN Chart.js URLs.
5. Keep chart data inline; do not fetch remote datasets (`connect-src 'none'`).
6. Stick to supported types: bar, line, pie, doughnut, radar, scatter.
7. Reveal decks may add Chart.js via `data-ark-runtime-addon-lib="chart.js"` and `data-ark-runtime-addon-version="4.5.1"`; see `agent-guides/20-chart-js.md`.

## Validation errors

| Code                       | Cause                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| `external_url`             | Any `http://` or `https://` asset URL (including CDNs)                      |
| `unapproved_runtime_asset` | `/api/runtimes/...` path not in manifest                                    |
| `runtime_version_mismatch` | Asset URL version ≠ declared version, or incomplete lib/version marker pair |
| `missing_runtime_assets`   | Required `chart.umd.min.js` not referenced                                  |
| `invalid_runtime_marker`   | Unknown `data-ark-*` marker value                                           |
| `script_without_marker`    | Inline/init scripts without `data-ark-preview="full-js"`                    |

## Related

- [runtimes.md](./runtimes.md) — Registry model and `/api/runtimes`
- [deck-bridge.md](./deck-bridge.md) — Full-JS bridge for chart decks
- `test/fixtures/chart-registry-deck.html` — Minimal valid fixture
- [#92](https://github.com/williamcr01/ark/issues/92) — Chart.js approved runtime
