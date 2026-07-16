# Chart.js

Use **Chart.js** when interactivity, tooltips, legends, or multi-series data warrant a library. Do **not** make Chart.js the default for every deck. Prefer **inline SVG** for simple static charts (single-series bar comparisons, sparklines, icons, small callouts).

## Hard rules

- Markers on `<html>`: `data-ark-preview="full-js"`, `data-ark-runtime="chart"`, `data-ark-runtime-lib="chart.js"`, `data-ark-runtime-version="4.5.1"`.
- Include the pinned registry script from the system prompt list: `/api/runtimes/chart.js/4.5.1/chart.umd.min.js`. CDN Chart.js URLs are invalid even if the version matches.
- Keep plain `section.slide` structure (not reveal). Do **not** set `data-ark-deck="nav"` unless the deck also owns slide navigation via the bridge protocol.
- Initialize with inline scripts: `new Chart(canvas, { ... })`. Keep `labels` / `datasets` inline as JSON from user data — never fetch remote datasets (`connect-src 'none'`).
- Always set `animation: false` in chart `options` so thumbnail capture is not mid-draw (Chart.js canvas animation is not covered by `document.getAnimations()`).
- Supported types for v1: `bar`, `line`, `pie`, `doughnut`, `radar`, `scatter`. No custom partial bundles.
- Size canvases for 16:9 slides: `responsive: true` and `maintainAspectRatio: false` inside a flex `.chart-wrap` that fills the slide.
- Plain chart decks use the markers above. **Reveal + Chart.js** decks keep reveal markers and add `data-ark-runtime-addon-lib="chart.js"` and `data-ark-runtime-addon-version="4.5.1"` on `<html>` (do **not** set `data-ark-preview="full-js"` on reveal decks).

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

**Ark injects:** full-JS bridge (`ark:deck-goto` / `ark:deck-slide-change`); CSP allows the pinned Chart.js asset + inline init.

**You author:** four markers, registry `<script>` tag, `<canvas>` + `new Chart(...)` init, optional slide nav listeners.

## Reveal.js + Chart.js

Use this when the deck is already reveal-based and only some slides need interactive charts.

- Keep `.reveal > .slides > section` structure and reveal markers (`data-ark-runtime="reveal"`, `data-ark-runtime-lib="reveal.js"`, `data-ark-runtime-version="5.1.0"`).
- Declare the Chart.js addon: `data-ark-runtime-addon-lib="chart.js"`, `data-ark-runtime-addon-version="4.5.1"`.
- Include both registry scripts: reveal.js + `/api/runtimes/chart.js/4.5.1/chart.umd.min.js`.
- Inline `new Chart(...)` init is allowed **only** with the addon markers. Do **not** call `Reveal.initialize()` — Ark's reveal adapter owns navigation.
- Put `<canvas>` elements inside reveal `<section>` slides. Use `responsive: true`, `maintainAspectRatio: false`, `animation: false`, and call `chart.resize()` on `ark:deck-slide-change` so hidden slides measure correctly.

```html
<html
  lang="en"
  data-ark-runtime="reveal"
  data-ark-runtime-lib="reveal.js"
  data-ark-runtime-version="5.1.0"
  data-ark-runtime-addon-lib="chart.js"
  data-ark-runtime-addon-version="4.5.1"
>
  <!-- reveal CSS, .reveal > .slides > section, reveal.js + chart.umd.min.js -->
  <script>
    const charts = []
    charts.push(new Chart(document.getElementById('revenueChart'), {/* ... */}))
    document.addEventListener('ark:deck-slide-change', () => charts.forEach((c) => c.resize()))
  </script>
</html>
```

## When to use SVG instead

Use inline SVG when:

- A single static comparison or sparkline is enough
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
- Always include `animation: false` (thumbnails settle too quickly for Chart.js's default 1s draw).
- Share common `options` (colors, legends, scales) across charts in one IIFE.
- Prefer deferred init / `addEventListener` over inline HTML event handlers.
- Match legend/tick colors to the deck theme (dark slides need light tick/label colors).
- Keep datasets small and presentation-grade — not raw CSV dumps.

## Limits

- Script-stripped thumbnail fallbacks show blank canvases; Chromium PNG thumbnails can capture after scripts run.
- Original download keeps `/api/runtimes/chart.js/...` URLs (needs Ark host); sanitized download strips scripts.
- No remote data loading, Chart.js plugins from CDNs, or unapproved versions.
