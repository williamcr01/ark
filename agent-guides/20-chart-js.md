# Chart.js

Prefer **inline SVG** for simple static charts (single-series bar comparisons, sparklines, icons, small callouts). Use **Chart.js** when interactivity, tooltips, legends, or multi-series data warrant a library. Do **not** make Chart.js the default for every deck.

## Hard rules

- Markers on `<html>`: `data-ark-preview="full-js"`, `data-ark-runtime="chart"`, `data-ark-runtime-lib="chart.js"`, `data-ark-runtime-version="4.5.1"`.
- Include the pinned registry script from the system prompt list: `/api/runtimes/chart.js/4.5.1/chart.umd.min.js`. CDN Chart.js URLs are invalid even if the version matches.
- Keep plain `section.slide` structure (not reveal). Do **not** set `data-ark-deck="nav"` unless the deck also owns slide navigation via the bridge protocol.
- Initialize with inline scripts: `new Chart(canvas, { ... })`. Keep `labels` / `datasets` inline as JSON from user data — never fetch remote datasets (`connect-src 'none'`).
- Supported types for v1: `bar`, `line`, `pie`, `doughnut`, `radar`, `scatter`. No custom partial bundles.
- Size canvases for 16:9 slides: `responsive: true` and `maintainAspectRatio: false` inside a flex `.chart-wrap` that fills the slide.
- Do not combine Chart.js with reveal.js in the same deck unless both runtimes are deliberately declared and tested.

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
        },
      })
    </script>
  </body>
</html>
```

**Ark injects:** full-JS bridge (`ark:deck-goto` / `ark:deck-slide-change`); CSP allows the pinned Chart.js asset + inline init.

**You author:** four markers, registry `<script>` tag, `<canvas>` + `new Chart(...)` init, optional slide nav listeners.

## When to use SVG instead

Use inline SVG when:

- A single static comparison or sparkline is enough
- Thumbnails / script-stripped fallbacks must show the chart without JS
- The edit is a small visual callout, not an interactive chart

## Multi-slide charts + navigation

Chart decks are plain `section.slide` documents. For shell-driven navigation, listen for `ark:deck-goto` and dispatch `ark:deck-slide-change` (same pattern as custom full-JS decks). There is no Chart.js-specific navigation adapter.

```html
<script>
  ;(() => {
    const slides = [...document.querySelectorAll('section.slide')]
    let index = 0
    function setSlide(next) {
      index = Math.max(0, Math.min(slides.length - 1, next))
      slides.forEach((slide, i) => {
        const active = i === index
        slide.classList.toggle('active', active)
        slide.setAttribute('aria-hidden', String(!active))
      })
      document.dispatchEvent(new CustomEvent('ark:deck-slide-change', { detail: { index } }))
    }
    document.addEventListener('ark:deck-goto', (event) => setSlide(event.detail.index))
    // create charts, then:
    setSlide(0)
  })()
</script>
```

## Chart config tips

- One `<canvas>` per chart region; give each an id and `role="img"` + `aria-label`.
- Share common `options` (colors, legends, scales) across charts in one IIFE.
- Prefer deferred init / `addEventListener` over inline HTML event handlers.
- Match legend/tick colors to the deck theme (dark slides need light tick/label colors).
- Keep datasets small and presentation-grade — not raw CSV dumps.

## Limits

- Script-stripped thumbnail fallbacks show blank canvases; Chromium PNG thumbnails can capture after scripts run.
- Original download keeps `/api/runtimes/chart.js/...` URLs (needs Ark host); sanitized download strips scripts.
- No remote data loading, Chart.js plugins from CDNs, or unapproved versions.
