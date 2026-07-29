import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import path from 'node:path'

import type { StructuredLogEntry } from '../../apps/api/observability/logger.ts'
import {
  assert,
  evaluate,
  findContextByUrl,
  openApp,
  setUploadFile,
  sleep,
  waitFor,
  type CdpClient,
  type RuntimeContext,
} from './browser-smoke.ts'

export const BENCHMARK_SCHEMA_VERSION = 2
export const BENCHMARK_DEFAULT_ITERATIONS = 10
export const BENCHMARK_DEFAULT_WARMUP = 1
export const BENCHMARK_POLL_MS = 16
export const BENCHMARK_THUMB_TIMEOUT_MS = 120_000

export type BenchmarkFixtureKind =
  'plain-css' | 'reveal-registry' | 'full-js' | 'plain-20' | 'reveal-20' | 'large-style'

export type BenchmarkScenarioId =
  'upload_cold' | 'upload_warm' | 'deck_reload_warm' | 'rapid_version_burst'

export type BenchmarkFixture = {
  id: BenchmarkFixtureKind
  label: string
  title: string
  slideCount: number
  path: string
  activeSlideText: string
  runtime: 'static' | 'reveal' | 'custom-js'
}

export type MetricId =
  | 'shell_ready_ms'
  | 'preview_iframe_src_ms'
  | 'preview_loading_clear_ms'
  | 'preview_active_slide_ms'
  | 'preview_bridge_ready_ms'
  | 'thumb_fallback_visible_ms'
  | 'thumb_png_first_src_ms'
  | 'thumb_png_first_decoded_ms'
  | 'thumb_png_visible_decoded_ms'
  | 'status_request_count'
  | 'preview_session_count'
  | 'mounted_iframe_peak'
  | 'dom_parser_count'
  | 'dom_parser_total_ms'
  | 'long_task_count'
  | 'long_task_total_ms'
  | 'long_task_max_ms'
  | 'thumbnail_render_duration_ms'
  | 'thumb_render_done_to_png_decoded_ms'
  | 'thumbnail_render_count'
  | 'burst_submit_ms'
  | 'final_version_thumb_ready_ms'

export type MetricSummary = {
  min: number
  median: number
  p90: number
  max: number
  mad: number
  samples: number
}

export type BenchmarkIterationResult = {
  index: number
  warmup: boolean
  metrics: Partial<Record<MetricId, number>>
  observability: {
    thumbnailRenderSucceeded: StructuredLogEntry | null
    previewSessionCreated: StructuredLogEntry | null
    thumbnailStatusReady: StructuredLogEntry | null
  }
}

export type BenchmarkScenarioResult = {
  scenario: BenchmarkScenarioId
  fixture: BenchmarkFixtureKind
  iterations: BenchmarkIterationResult[]
  summary: Partial<Record<MetricId, MetricSummary>>
}

export type BenchmarkRunResult = {
  schemaVersion: number
  runId: string
  createdAt: string
  gitSha: string | null
  webMode: 'development' | 'production'
  iterations: number
  warmup: number
  environment: {
    node: string
    platform: string
    arch: string
  }
  results: BenchmarkScenarioResult[]
}

export type BenchmarkCompareThresholds = {
  medianRegressionPct: number
  p90RegressionPct: number
  absoluteFloorMs: number
}

export type BenchmarkCompareFailure = {
  scenario: BenchmarkScenarioId
  fixture: BenchmarkFixtureKind
  metric: MetricId
  baseline: number
  current: number
  regressionPct: number
  kind: 'median' | 'p90'
}

export type ShellProbeState = {
  bodyText: string
  slideCounter: string | null
  previewSrc: string
  previewLoading: boolean
  stripHidden: boolean
  thumbIframeCount: number
  thumbImageCount: number
  thumbImagesDecoded: number
  thumbImagesReady: number
  statusRequestCount: number
  previewSessionCount: number
  domParserCount: number
  domParserTotalMs: number
  longTaskCount: number
  longTaskTotalMs: number
  longTaskMaxMs: number
}

const HEADLINE_METRICS: MetricId[] = [
  'shell_ready_ms',
  'preview_active_slide_ms',
  'thumb_png_visible_decoded_ms',
  'final_version_thumb_ready_ms',
  'preview_session_count',
  'status_request_count',
  'mounted_iframe_peak',
  'long_task_total_ms',
]

const BENCHMARK_INSTRUMENTATION_SOURCE = `(() => {
  if (window.__arkBenchmark) {
    return true
  }

  const state = {
    parses: [],
    longTasks: [],
    statusRequests: 0,
    previewSessions: 0,
  }

  const OriginalParser = window.DOMParser
  window.DOMParser = class extends OriginalParser {
    parseFromString(source, type) {
      const started = performance.now()
      const result = super.parseFromString(source, type)
      state.parses.push({
        bytes: typeof source === 'string' ? source.length : 0,
        ms: performance.now() - started,
      })
      return result
    }
  }

  const OriginalFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

    if (url.includes('/thumbnails?')) {
      state.statusRequests += 1
    }

    if (url.includes('/preview-sessions') && (!init || !init.method || init.method.toUpperCase() === 'POST')) {
      state.previewSessions += 1
    }

    return OriginalFetch(input, init)
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTasks.push({
          start: entry.startTime,
          duration: entry.duration,
        })
      }
    })
    observer.observe({ type: 'longtask', buffered: true })
  } catch {
    // Long Tasks API is Chromium-only; benchmarks still collect other metrics.
  }

  window.__arkBenchmark = state
  return true
})()`

export function percentile(sorted: number[], ratio: number) {
  if (sorted.length === 0) {
    return 0
  }

  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]!
}

export function summarizeSamples(samples: number[]): MetricSummary | null {
  if (samples.length === 0) {
    return null
  }

  const sorted = [...samples].sort((left, right) => left - right)
  const median = percentile(sorted, 0.5)
  const deviations = sorted
    .map((value) => Math.abs(value - median))
    .sort((left, right) => left - right)

  return {
    min: sorted[0]!,
    median,
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1]!,
    mad: percentile(deviations, 0.5),
    samples: sorted.length,
  }
}

export function summarizeScenario(iterations: BenchmarkIterationResult[]) {
  const measured = iterations.filter((iteration) => !iteration.warmup)
  const summary: Partial<Record<MetricId, MetricSummary>> = {}
  const metricIds = new Set<MetricId>()

  for (const iteration of measured) {
    for (const metricId of Object.keys(iteration.metrics) as MetricId[]) {
      metricIds.add(metricId)
    }
  }

  for (const metricId of metricIds) {
    const samples = measured
      .map((iteration) => iteration.metrics[metricId])
      .filter((value): value is number => typeof value === 'number')
    const metricSummary = summarizeSamples(samples)

    if (metricSummary) {
      summary[metricId] = metricSummary
    }
  }

  return summary
}

export function compareBenchmarkRuns(
  baseline: BenchmarkRunResult,
  current: BenchmarkRunResult,
  thresholds: BenchmarkCompareThresholds = {
    medianRegressionPct: 5,
    p90RegressionPct: 10,
    absoluteFloorMs: 50,
  },
) {
  const failures: BenchmarkCompareFailure[] = []
  const warnings: BenchmarkCompareFailure[] = []

  for (const currentScenario of current.results) {
    const baselineScenario = baseline.results.find(
      (entry) =>
        entry.scenario === currentScenario.scenario && entry.fixture === currentScenario.fixture,
    )

    if (!baselineScenario) {
      continue
    }

    for (const metricId of HEADLINE_METRICS) {
      const baselineMetric = baselineScenario.summary[metricId]
      const currentMetric = currentScenario.summary[metricId]

      if (!baselineMetric || !currentMetric || baselineMetric.median <= 0) {
        continue
      }

      const p90Delta = currentMetric.p90 - baselineMetric.p90
      const p90Pct = (p90Delta / baselineMetric.p90) * 100
      const medianDelta = currentMetric.median - baselineMetric.median
      const medianPct = (medianDelta / baselineMetric.median) * 100
      const countLike =
        metricId === 'status_request_count' ||
        metricId === 'preview_session_count' ||
        metricId === 'mounted_iframe_peak' ||
        metricId === 'dom_parser_count' ||
        metricId === 'long_task_count'
      const floor = countLike ? 0.5 : thresholds.absoluteFloorMs

      if (p90Pct > thresholds.p90RegressionPct && p90Delta > floor) {
        failures.push({
          scenario: currentScenario.scenario,
          fixture: currentScenario.fixture,
          metric: metricId,
          baseline: baselineMetric.p90,
          current: currentMetric.p90,
          regressionPct: p90Pct,
          kind: 'p90',
        })
      } else if (medianPct > thresholds.medianRegressionPct && medianDelta > floor) {
        warnings.push({
          scenario: currentScenario.scenario,
          fixture: currentScenario.fixture,
          metric: metricId,
          baseline: baselineMetric.median,
          current: currentMetric.median,
          regressionPct: medianPct,
          kind: 'median',
        })
      }
    }
  }

  return { failures, warnings, ok: failures.length === 0 }
}

export function formatMetricTable(result: BenchmarkRunResult) {
  const lines = [
    `run ${result.runId} webMode=${result.webMode} iterations=${result.iterations} warmup=${result.warmup}`,
    '',
  ]

  for (const scenario of result.results) {
    lines.push(`${scenario.scenario}/${scenario.fixture}`)

    for (const metricId of HEADLINE_METRICS) {
      const summary = scenario.summary[metricId]

      if (!summary) {
        continue
      }

      lines.push(
        `  ${metricId.padEnd(34)} median=${summary.median.toFixed(1)} p90=${summary.p90.toFixed(1)} mad=${summary.mad.toFixed(1)} n=${summary.samples}`,
      )
    }

    lines.push('')
  }

  return lines.join('\n')
}

export async function installBenchmarkInstrumentation(cdp: CdpClient) {
  await cdp
    .send('Page.addScriptToEvaluateOnNewDocument', {
      source: BENCHMARK_INSTRUMENTATION_SOURCE,
    })
    .catch(() => undefined)
  await evaluate<boolean>(cdp, BENCHMARK_INSTRUMENTATION_SOURCE)
}

export async function resetBenchmarkInstrumentation(cdp: CdpClient) {
  await evaluate<boolean>(
    cdp,
    `(() => {
      if (!window.__arkBenchmark) {
        return false
      }

      window.__arkBenchmark.parses = []
      window.__arkBenchmark.longTasks = []
      window.__arkBenchmark.statusRequests = 0
      window.__arkBenchmark.previewSessions = 0
      return true
    })()`,
  )
}

export async function readShellProbe(cdp: CdpClient): Promise<ShellProbeState> {
  return evaluate<ShellProbeState>(
    cdp,
    `(() => {
      const bodyText = document.body?.innerText || ''
      const slideMatch = bodyText.match(/Slide\\s+(\\d+)\\s+of\\s+(\\d+)/i)
      const preview = document.querySelector('iframe[title="Generated Ark presentation preview"]')
      const strip = document.getElementById('ark-slide-strip')
      const thumbIframes = [...document.querySelectorAll('iframe[title$="thumbnail"]')]
      const thumbImages = [...document.querySelectorAll('img[title$="thumbnail"]')]
      const bench = window.__arkBenchmark || {
        parses: [],
        longTasks: [],
        statusRequests: 0,
        previewSessions: 0,
      }
      const longTaskTotal = bench.longTasks.reduce((sum, entry) => sum + entry.duration, 0)
      const longTaskMax = bench.longTasks.reduce((max, entry) => Math.max(max, entry.duration), 0)

      return {
        bodyText,
        slideCounter: slideMatch ? slideMatch[0] : null,
        previewSrc: preview?.getAttribute('src') || '',
        previewLoading: bodyText.includes('Loading sandbox preview'),
        stripHidden: strip ? strip.getAttribute('aria-hidden') === 'true' : true,
        thumbIframeCount: thumbIframes.length,
        thumbImageCount: thumbImages.length,
        thumbImagesDecoded: thumbImages.filter((img) => img.complete && img.naturalWidth > 0).length,
        thumbImagesReady: thumbImages.filter((img) => {
          const src = img.getAttribute('src') || ''
          return src.includes('/thumbnails/') && src.includes('.png')
        }).length,
        statusRequestCount: Number(bench.statusRequests || 0),
        previewSessionCount: Number(bench.previewSessions || 0),
        domParserCount: bench.parses.length,
        domParserTotalMs: bench.parses.reduce((sum, entry) => sum + entry.ms, 0),
        longTaskCount: bench.longTasks.length,
        longTaskTotalMs: longTaskTotal,
        longTaskMaxMs: longTaskMax,
      }
    })()`,
  )
}

export async function ensureStripOpen(cdp: CdpClient) {
  const opened = await evaluate<boolean>(
    cdp,
    `(() => {
      const strip = document.getElementById('ark-slide-strip')
      if (strip && strip.getAttribute('aria-hidden') !== 'true') {
        return true
      }

      // Strip not mounted yet (e.g. deferred parse still empty). Wait without
      // clicking — the toggle would collapse the default-open strip once it appears.
      if (!strip) {
        return true
      }

      const toggle = document.querySelector('button[aria-controls="ark-slide-strip"]')
      if (!toggle) {
        return false
      }

      toggle.click()
      return true
    })()`,
  )

  assert(opened, 'Could not open the slide thumbnail strip.')

  await waitFor('slide strip open', async () => {
    const probe = await readShellProbe(cdp)
    return !probe.stripHidden
  })
}

export async function readActiveDeckIdFromShell(cdp: CdpClient) {
  return evaluate<string | null>(
    cdp,
    `(() => {
      try {
        const match = window.location.pathname.match(/^\\/decks\\/([^/]+)/)
        const id = match?.[1]
        if (id && id !== 'new') {
          return id
        }
        return window.localStorage?.getItem('ark:active-deck-id') || null
      } catch {
        return null
      }
    })()`,
  )
}

export async function readShellVersionNumber(cdp: CdpClient) {
  const value = await evaluate<string>(
    cdp,
    `[
      document.body?.innerText || '',
      document.title || ''
    ].join('\\n')`,
  )
  const match = value.match(/(?:^|[\\s·])v(\\d+)\\b/i)
  return match ? Number(match[1]) : null
}

export function mutateFixtureHtml(html: string, index: number) {
  const normalizedIndex = Math.max(0, Math.floor(index))
  const mutation = `Benchmark mutation ${normalizedIndex}`
  const replaceText = (text: string) =>
    text.replace(/\s+·\s+Benchmark mutation \d+/g, '').trimEnd() + ` · ${mutation}`

  return html.replace(
    /(<(?:h1|h2|p)\b[^>]*>)([^<]*)(<\/(?:h1|h2|p)>)/i,
    (_match, open: string, text: string, close: string) => `${open}${replaceText(text)}${close}`,
  )
}

export async function burstDeckVersions(options: {
  apiOrigin: string
  deckId: string
  baseHtml: string
  count: number
  startIndex?: number
}) {
  const startedAt = performance.now()
  const count = Math.max(1, Math.floor(options.count))
  const startIndex = Math.max(0, Math.floor(options.startIndex ?? 0))
  let finalDeck: {
    id: string
    html: string
    title: string
    activeVersionId?: string | null
    versionNumber?: number | null
  } | null = null
  let finalHtml = options.baseHtml

  for (let offset = 0; offset < count; offset += 1) {
    const mutationIndex = startIndex + offset
    finalHtml = mutateFixtureHtml(options.baseHtml, mutationIndex)
    const response = await fetch(
      `${options.apiOrigin}/api/decks/${encodeURIComponent(options.deckId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: finalHtml,
          source: 'manual',
          summary: `Benchmark burst mutation ${mutationIndex}`,
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`Burst PUT ${offset + 1}/${count} failed with ${response.status}.`)
    }

    const payload = (await response.json()) as {
      deck?: typeof finalDeck
      error?: string
    }

    if (!payload.deck) {
      throw new Error(payload.error ?? `Burst PUT ${offset + 1}/${count} returned no deck.`)
    }

    finalDeck = payload.deck
  }

  if (!finalDeck) {
    throw new Error('Burst did not persist any deck versions.')
  }

  if (!finalDeck.activeVersionId) {
    throw new Error('Burst final deck is missing activeVersionId.')
  }

  return {
    deck: finalDeck,
    html: finalHtml,
    burstSubmitMs: Number((performance.now() - startedAt).toFixed(1)),
  }
}

/**
 * Poll thumbnail status for a specific version until PNGs are ready.
 * This is the queue-concurrency signal for rapid_version_burst: it starts after
 * the last PUT and does not include a shell reload.
 */
export async function waitForFinalVersionThumbnailsReady(options: {
  apiOrigin: string
  deckId: string
  versionId: string
  expectedSlideCount: number
  timeoutMs?: number
  waitMs?: number
  fetchImpl?: typeof fetch
}) {
  const timeoutMs = options.timeoutMs ?? BENCHMARK_THUMB_TIMEOUT_MS
  const waitMs = Math.max(0, Math.min(options.waitMs ?? 2_000, 5_000))
  const fetchImpl = options.fetchImpl ?? fetch
  const startedAt = performance.now()
  const deadline = Date.now() + timeoutMs
  const expectedSlides = Math.max(1, Math.floor(options.expectedSlideCount))

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now())
    const pollWaitMs = Math.min(waitMs, remainingMs)
    const url = new URL(
      `${options.apiOrigin}/api/decks/${encodeURIComponent(options.deckId)}/thumbnails`,
    )
    url.searchParams.set('versionId', options.versionId)
    url.searchParams.set('waitMs', String(pollWaitMs))

    const response = await fetchImpl(url)
    if (!response.ok) {
      throw new Error(
        `Thumbnail status for ${options.versionId} failed with HTTP ${response.status}.`,
      )
    }

    const payload = (await response.json()) as {
      status?: string
      slides?: Array<{ index: number; url: string }>
      error?: string
    }

    if (payload.status === 'failed') {
      throw new Error(payload.error ?? `Thumbnail render failed for version ${options.versionId}.`)
    }

    if (
      payload.status === 'ready' &&
      Array.isArray(payload.slides) &&
      payload.slides.length >= expectedSlides &&
      payload.slides.every((slide) => typeof slide.url === 'string' && slide.url.length > 0)
    ) {
      return {
        readyMs: Number((performance.now() - startedAt).toFixed(1)),
        slideCount: payload.slides.length,
      }
    }

    if (payload.status === 'disabled') {
      throw new Error('Thumbnail renderer is disabled; rapid_version_burst requires it on.')
    }

    await sleep(BENCHMARK_POLL_MS)
  }

  throw new Error(
    `Timed out waiting for thumbnails ready for version ${options.versionId} (expected ${expectedSlides} slides).`,
  )
}

function nestedFields(entry: StructuredLogEntry | null | undefined) {
  const nested = entry?.fields?.fields
  return nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : {}
}

function findThumbnailStatusReady(entries: StructuredLogEntry[]) {
  return (
    entries.find(
      (entry) => entry.event === 'thumbnail.status' && nestedFields(entry).status === 'ready',
    ) ?? null
  )
}

function collectBenchmarkObservability(entries: StructuredLogEntry[]) {
  return {
    thumbnailRenderSucceeded:
      entries.find((entry) => entry.event === 'thumbnail.render.succeeded') ?? null,
    previewSessionCreated:
      entries.find((entry) => entry.event === 'preview.session.created') ?? null,
    thumbnailStatusReady: findThumbnailStatusReady(entries),
  }
}

function countThumbnailRenders(entries: StructuredLogEntry[]) {
  return entries.filter((entry) => entry.event === 'thumbnail.render.succeeded').length
}

async function decodeReadyThumbnailImages(cdp: CdpClient) {
  return evaluate<number>(
    cdp,
    `(async () => {
      const images = [...document.querySelectorAll('img[title$="thumbnail"]')]
        .filter((img) => {
          const src = img.getAttribute('src') || ''
          return src.includes('/thumbnails/') && src.includes('.png')
        })

      await Promise.all(images.map((img) => {
        if (typeof img.decode === 'function') {
          return img.decode().catch(() => undefined)
        }

        if (img.complete) {
          return undefined
        }

        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true })
          img.addEventListener('error', resolve, { once: true })
        })
      }))

      return images.filter((img) => img.complete && img.naturalWidth > 0).length
    })()`,
  )
}

export function buildPlainFixtureHtml(options: {
  title: string
  slideCount: number
  styleBytes?: number
}) {
  const styleExtra =
    typeof options.styleBytes === 'number' && options.styleBytes > 0
      ? Array.from({ length: Math.ceil(options.styleBytes / 24) }, (_, index) => {
          return `.c${index}{padding:${index % 20}px;color:#123456}`
        }).join('')
      : ''

  const slides = Array.from({ length: options.slideCount }, (_, index) => {
    const heading =
      index === 0 ? `<h1>${options.title} slide ${index + 1}</h1>` : `<h2>Slide ${index + 1}</h2>`
    return `<section class="slide" data-title="Slide ${index + 1}">${heading}<p>Benchmark content</p></section>`
  }).join('\n')

  return `<!doctype html>
<html lang="en" data-deck="benchmark-plain">
  <head>
    <meta charset="UTF-8" />
    <title>${options.title}</title>
    <style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; font-family: system-ui, sans-serif; }
      section.slide { display: none; width: 100vw; height: 100vh; align-items: center; justify-content: center; background: white; color: #172033; }
      section.slide.active, section.slide.is-active { display: flex; }
      ${styleExtra}
    </style>
  </head>
  <body>
    ${slides}
  </body>
</html>
`
}

export function buildRevealFixtureHtml(options: { title: string; slideCount: number }) {
  const slides = Array.from({ length: options.slideCount }, (_, index) => {
    const heading = index === 0 ? `<h1>${options.title}</h1>` : `<h2>Reveal slide ${index + 1}</h2>`
    return `<section>${heading}<p>Benchmark content</p></section>`
  }).join('\n')

  return `<!doctype html>
<html
  lang="en"
  data-ark-runtime="reveal"
  data-ark-runtime-lib="reveal.js"
  data-ark-runtime-version="5.1.0"
>
  <head>
    <meta charset="UTF-8" />
    <title>${options.title}</title>
    <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/reveal.css" />
    <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/theme/white.css" />
  </head>
  <body>
    <div class="reveal">
      <div class="slides">
        ${slides}
      </div>
    </div>
    <script src="/api/runtimes/reveal.js/5.1.0/reveal.js"></script>
  </body>
</html>
`
}

export async function measureUploadScenario(options: {
  cdp: CdpClient
  contexts: Map<string, RuntimeContext>
  sandboxOrigin: string
  fixture: BenchmarkFixture
  timeoutMs?: number
  observabilityEntries: StructuredLogEntry[]
}) {
  const timeoutMs = options.timeoutMs ?? BENCHMARK_THUMB_TIMEOUT_MS
  const visibleThumbTarget = Math.min(options.fixture.slideCount, 7)
  const metrics: Partial<Record<MetricId, number>> = {}
  let peakIframes = 0

  await resetBenchmarkInstrumentation(options.cdp)
  const startedAt = performance.now()
  await setUploadFile(options.cdp, options.fixture.path)

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const probe = await readShellProbe(options.cdp)
    const elapsed = performance.now() - startedAt
    peakIframes = Math.max(peakIframes, probe.thumbIframeCount)

    if (
      !metrics.shell_ready_ms &&
      probe.bodyText.includes(options.fixture.title) &&
      probe.slideCounter?.includes(`of ${options.fixture.slideCount}`)
    ) {
      metrics.shell_ready_ms = Number(elapsed.toFixed(1))
    }

    if (
      !metrics.preview_iframe_src_ms &&
      probe.previewSrc.startsWith(`${options.sandboxOrigin}/render/`)
    ) {
      metrics.preview_iframe_src_ms = Number(elapsed.toFixed(1))
    }

    if (
      !metrics.preview_loading_clear_ms &&
      metrics.preview_iframe_src_ms &&
      !probe.previewLoading
    ) {
      metrics.preview_loading_clear_ms = Number(elapsed.toFixed(1))
    }

    if (
      !metrics.preview_active_slide_ms &&
      probe.previewSrc.startsWith(`${options.sandboxOrigin}/render/`)
    ) {
      const previewContext = await findContextByUrl(options.cdp, options.contexts, probe.previewSrc)

      if (previewContext) {
        const active = await evaluate<boolean>(
          options.cdp,
          `(() => {
            const active = document.querySelector(
              'section.slide.active, section.slide.is-active, .reveal .slides section.present, .reveal .slides section[data-active]'
            )
            const text = (active?.textContent || document.body?.innerText || '')
            return text.includes(${JSON.stringify(options.fixture.activeSlideText)})
          })()`,
          { contextId: previewContext.id, sessionId: previewContext.sessionId },
        ).catch(() => false)

        if (active) {
          metrics.preview_active_slide_ms = Number(elapsed.toFixed(1))

          if (options.fixture.runtime !== 'static') {
            const bridgeReady = await evaluate<boolean>(
              options.cdp,
              `Boolean(
                document.querySelector('script[data-ark-preview-bridge], script[data-ark-preview-reveal], script[data-ark-preview-nav]')
              )`,
              { contextId: previewContext.id, sessionId: previewContext.sessionId },
            ).catch(() => false)

            if (bridgeReady) {
              metrics.preview_bridge_ready_ms = Number(elapsed.toFixed(1))
            }
          } else {
            metrics.preview_bridge_ready_ms = Number(elapsed.toFixed(1))
          }
        }
      }
    }

    // Strip is only required for thumbnail metrics. Keep collecting preview
    // timings even while the strip is still mounting or closed.
    if (metrics.shell_ready_ms && probe.stripHidden) {
      await ensureStripOpen(options.cdp).catch(() => undefined)
      continue
    }

    if (!metrics.thumb_fallback_visible_ms && probe.thumbIframeCount > 0) {
      metrics.thumb_fallback_visible_ms = Number(elapsed.toFixed(1))
    }

    if (!metrics.thumb_png_first_src_ms && probe.thumbImagesReady > 0) {
      metrics.thumb_png_first_src_ms = Number(elapsed.toFixed(1))
    }

    if (!metrics.thumb_png_first_decoded_ms && probe.thumbImagesDecoded > 0) {
      metrics.thumb_png_first_decoded_ms = Number(elapsed.toFixed(1))
    }

    if (!metrics.thumb_png_visible_decoded_ms && probe.thumbImagesDecoded >= visibleThumbTarget) {
      metrics.thumb_png_visible_decoded_ms = Number(elapsed.toFixed(1))
    }

    const complete =
      metrics.shell_ready_ms &&
      metrics.preview_active_slide_ms &&
      metrics.thumb_png_visible_decoded_ms &&
      metrics.preview_loading_clear_ms

    if (complete) {
      metrics.status_request_count = probe.statusRequestCount
      metrics.preview_session_count = probe.previewSessionCount
      metrics.mounted_iframe_peak = peakIframes
      metrics.dom_parser_count = probe.domParserCount
      metrics.dom_parser_total_ms = Number(probe.domParserTotalMs.toFixed(1))
      metrics.long_task_count = probe.longTaskCount
      metrics.long_task_total_ms = Number(probe.longTaskTotalMs.toFixed(1))
      metrics.long_task_max_ms = Number(probe.longTaskMaxMs.toFixed(1))
      break
    }

    await sleep(BENCHMARK_POLL_MS)
  }

  if (
    !metrics.shell_ready_ms ||
    !metrics.preview_active_slide_ms ||
    !metrics.thumb_png_visible_decoded_ms
  ) {
    throw new Error(
      `Timed out measuring ${options.fixture.id}. Collected metrics: ${JSON.stringify(metrics)}`,
    )
  }

  const finalProbe = await readShellProbe(options.cdp)
  metrics.status_request_count = finalProbe.statusRequestCount
  metrics.preview_session_count = finalProbe.previewSessionCount
  metrics.mounted_iframe_peak = Math.max(peakIframes, finalProbe.thumbIframeCount)
  metrics.dom_parser_count = finalProbe.domParserCount
  metrics.dom_parser_total_ms = Number(finalProbe.domParserTotalMs.toFixed(1))
  metrics.long_task_count = finalProbe.longTaskCount
  metrics.long_task_total_ms = Number(finalProbe.longTaskTotalMs.toFixed(1))
  metrics.long_task_max_ms = Number(finalProbe.longTaskMaxMs.toFixed(1))

  const { thumbnailRenderSucceeded, previewSessionCreated, thumbnailStatusReady } =
    collectBenchmarkObservability(options.observabilityEntries)
  metrics.thumbnail_render_count = countThumbnailRenders(options.observabilityEntries)

  if (typeof thumbnailRenderSucceeded?.durationMs === 'number') {
    metrics.thumbnail_render_duration_ms = thumbnailRenderSucceeded.durationMs
  }

  if (thumbnailRenderSucceeded && metrics.thumb_png_visible_decoded_ms) {
    const renderDoneAt = Date.parse(thumbnailRenderSucceeded.timestamp)

    if (!Number.isNaN(renderDoneAt)) {
      // Approximate wall-clock correlation: elapsed metric is from Node t0;
      // use relative gap only when render succeeded before PNG visibility.
      const renderDuration = thumbnailRenderSucceeded.durationMs ?? 0
      metrics.thumb_render_done_to_png_decoded_ms = Math.max(
        0,
        Number((metrics.thumb_png_visible_decoded_ms - renderDuration).toFixed(1)),
      )
    }
  }

  return {
    metrics,
    observability: {
      thumbnailRenderSucceeded,
      previewSessionCreated,
      thumbnailStatusReady,
    },
  }
}

export async function measureDeckReloadWarmScenario(options: {
  cdp: CdpClient
  contexts: Map<string, RuntimeContext>
  appOrigin: string
  sandboxOrigin: string
  fixture: BenchmarkFixture
  timeoutMs?: number
  observabilityEntries: StructuredLogEntry[]
}) {
  const timeoutMs = options.timeoutMs ?? BENCHMARK_THUMB_TIMEOUT_MS
  const visibleThumbTarget = Math.min(options.fixture.slideCount, 7)
  const metrics: Partial<Record<MetricId, number>> = {}
  let peakIframes = 0

  await resetBenchmarkInstrumentation(options.cdp).catch(() => undefined)
  const startedAt = performance.now()
  await openApp(options.cdp, options.appOrigin)
  await installBenchmarkInstrumentation(options.cdp)

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const probe = await readShellProbe(options.cdp)
    const elapsed = performance.now() - startedAt
    peakIframes = Math.max(peakIframes, probe.thumbIframeCount)

    if (
      !metrics.shell_ready_ms &&
      probe.bodyText.includes(options.fixture.title) &&
      probe.slideCounter?.includes(`of ${options.fixture.slideCount}`)
    ) {
      metrics.shell_ready_ms = Number(elapsed.toFixed(1))
    }

    if (
      !metrics.preview_iframe_src_ms &&
      probe.previewSrc.startsWith(`${options.sandboxOrigin}/render/`)
    ) {
      metrics.preview_iframe_src_ms = Number(elapsed.toFixed(1))
    }

    if (
      !metrics.preview_loading_clear_ms &&
      metrics.preview_iframe_src_ms &&
      !probe.previewLoading
    ) {
      metrics.preview_loading_clear_ms = Number(elapsed.toFixed(1))
    }

    if (
      !metrics.preview_active_slide_ms &&
      probe.previewSrc.startsWith(`${options.sandboxOrigin}/render/`)
    ) {
      const previewContext = await findContextByUrl(options.cdp, options.contexts, probe.previewSrc)

      if (previewContext) {
        const active = await evaluate<boolean>(
          options.cdp,
          `(() => {
            const active = document.querySelector(
              'section.slide.active, section.slide.is-active, .reveal .slides section.present, .reveal .slides section[data-active]'
            )
            const text = (active?.textContent || document.body?.innerText || '')
            return text.includes(${JSON.stringify(options.fixture.activeSlideText)})
          })()`,
          { contextId: previewContext.id, sessionId: previewContext.sessionId },
        ).catch(() => false)

        if (active) {
          metrics.preview_active_slide_ms = Number(elapsed.toFixed(1))
        }
      }
    }

    // Strip is only required for thumbnail metrics. Keep collecting preview
    // timings even while the strip is still mounting or closed.
    if (metrics.shell_ready_ms && probe.stripHidden) {
      await ensureStripOpen(options.cdp).catch(() => undefined)
      continue
    }

    if (!metrics.thumb_fallback_visible_ms && probe.thumbIframeCount > 0) {
      metrics.thumb_fallback_visible_ms = Number(elapsed.toFixed(1))
    }

    if (!metrics.thumb_png_first_src_ms && probe.thumbImagesReady > 0) {
      metrics.thumb_png_first_src_ms = Number(elapsed.toFixed(1))
    }

    if (!metrics.thumb_png_first_decoded_ms && probe.thumbImagesDecoded > 0) {
      metrics.thumb_png_first_decoded_ms = Number(elapsed.toFixed(1))
    }

    if (!metrics.thumb_png_visible_decoded_ms && probe.thumbImagesDecoded >= visibleThumbTarget) {
      metrics.thumb_png_visible_decoded_ms = Number(elapsed.toFixed(1))
    }

    const complete =
      metrics.shell_ready_ms &&
      metrics.preview_active_slide_ms &&
      metrics.thumb_png_visible_decoded_ms &&
      metrics.preview_loading_clear_ms

    if (complete) {
      break
    }

    await sleep(BENCHMARK_POLL_MS)
  }

  if (
    !metrics.shell_ready_ms ||
    !metrics.preview_active_slide_ms ||
    !metrics.thumb_png_visible_decoded_ms
  ) {
    throw new Error(
      `Timed out measuring warm deck reload for ${options.fixture.id}. Collected metrics: ${JSON.stringify(metrics)}`,
    )
  }

  const finalProbe = await readShellProbe(options.cdp)
  metrics.status_request_count = finalProbe.statusRequestCount
  metrics.preview_session_count = finalProbe.previewSessionCount
  metrics.mounted_iframe_peak = Math.max(peakIframes, finalProbe.thumbIframeCount)
  metrics.dom_parser_count = finalProbe.domParserCount
  metrics.dom_parser_total_ms = Number(finalProbe.domParserTotalMs.toFixed(1))
  metrics.long_task_count = finalProbe.longTaskCount
  metrics.long_task_total_ms = Number(finalProbe.longTaskTotalMs.toFixed(1))
  metrics.long_task_max_ms = Number(finalProbe.longTaskMaxMs.toFixed(1))
  metrics.thumbnail_render_count = countThumbnailRenders(options.observabilityEntries)

  if (metrics.thumbnail_render_count !== 0) {
    throw new Error(
      `Warm deck reload unexpectedly rendered ${metrics.thumbnail_render_count} thumbnail batch(es).`,
    )
  }

  return {
    metrics,
    observability: collectBenchmarkObservability(options.observabilityEntries),
  }
}

export async function measureRapidVersionBurstScenario(options: {
  cdp: CdpClient
  contexts: Map<string, RuntimeContext>
  appOrigin: string
  apiOrigin: string
  sandboxOrigin: string
  deckId: string
  baseHtml: string
  fixture: BenchmarkFixture
  burstCount: number
  mutationStartIndex?: number
  timeoutMs?: number
  observabilityEntries: StructuredLogEntry[]
}) {
  const timeoutMs = options.timeoutMs ?? BENCHMARK_THUMB_TIMEOUT_MS
  const visibleThumbTarget = Math.min(options.fixture.slideCount, 7)
  const metrics: Partial<Record<MetricId, number>> = {}
  let peakIframes = 0

  await resetBenchmarkInstrumentation(options.cdp).catch(() => undefined)
  const burst = await burstDeckVersions({
    apiOrigin: options.apiOrigin,
    deckId: options.deckId,
    baseHtml: options.baseHtml,
    count: options.burstCount,
    startIndex: options.mutationStartIndex,
  })
  metrics.burst_submit_ms = burst.burstSubmitMs

  const finalVersionId = burst.deck.activeVersionId
  assert(finalVersionId, 'Burst final deck is missing activeVersionId.')

  const expectedVersionNumber =
    typeof burst.deck.versionNumber === 'number' ? burst.deck.versionNumber : null
  const finalMutationIndex =
    Math.max(0, Math.floor(options.mutationStartIndex ?? 0)) +
    Math.max(1, Math.floor(options.burstCount)) -
    1
  const expectedActiveSlideText = `Benchmark mutation ${finalMutationIndex}`

  // Primary concurrency signal: API thumbnail readiness for the final version,
  // measured from the instant the last PUT returns — no shell reload in this timer.
  const apiReady = await waitForFinalVersionThumbnailsReady({
    apiOrigin: options.apiOrigin,
    deckId: options.deckId,
    versionId: finalVersionId,
    expectedSlideCount: options.fixture.slideCount,
    timeoutMs,
  })
  metrics.final_version_thumb_ready_ms = apiReady.readyMs

  // Secondary shell path: reload once thumbs are already ready.
  // Require shell + active preview for the final mutation (integration check).
  // Visible PNG decode is best-effort: headless can flake to srcDoc iframe
  // fallback even when the API already reported ready; concurrency decisions
  // use final_version_thumb_ready_ms only.
  const shellTimeoutMs = Math.min(timeoutMs, 30_000)
  const decodeSoftDeadline = Date.now() + Math.min(timeoutMs, 5_000)
  const startedAt = performance.now()
  await openApp(options.cdp, options.appOrigin)
  await installBenchmarkInstrumentation(options.cdp)

  const deadline = Date.now() + shellTimeoutMs

  while (Date.now() < deadline) {
    const probe = await readShellProbe(options.cdp)
    const elapsed = performance.now() - startedAt
    peakIframes = Math.max(peakIframes, probe.thumbIframeCount)
    const shellVersion = await readShellVersionNumber(options.cdp).catch(() => null)
    const expectedShellVersionVisible =
      expectedVersionNumber === null ||
      (typeof shellVersion === 'number' && shellVersion >= expectedVersionNumber)

    if (
      !metrics.shell_ready_ms &&
      probe.bodyText.includes(options.fixture.title) &&
      probe.slideCounter?.includes(`of ${options.fixture.slideCount}`)
    ) {
      metrics.shell_ready_ms = Number(elapsed.toFixed(1))
    }

    if (
      !metrics.preview_iframe_src_ms &&
      probe.previewSrc.startsWith(`${options.sandboxOrigin}/render/`)
    ) {
      metrics.preview_iframe_src_ms = Number(elapsed.toFixed(1))
    }

    if (
      !metrics.preview_loading_clear_ms &&
      metrics.preview_iframe_src_ms &&
      !probe.previewLoading
    ) {
      metrics.preview_loading_clear_ms = Number(elapsed.toFixed(1))
    }

    if (
      !metrics.preview_active_slide_ms &&
      probe.previewSrc.startsWith(`${options.sandboxOrigin}/render/`)
    ) {
      const previewContext = await findContextByUrl(options.cdp, options.contexts, probe.previewSrc)

      if (previewContext) {
        const active = await evaluate<boolean>(
          options.cdp,
          `(() => {
            const active = document.querySelector(
              'section.slide.active, section.slide.is-active, .reveal .slides section.present, .reveal .slides section[data-active]'
            )
            const text = (active?.textContent || document.body?.innerText || '')
            return text.includes(${JSON.stringify(expectedActiveSlideText)})
          })()`,
          { contextId: previewContext.id, sessionId: previewContext.sessionId },
        ).catch(() => false)

        if (active) {
          metrics.preview_active_slide_ms = Number(elapsed.toFixed(1))
        }
      }
    }

    // Strip is only required for thumbnail metrics. Keep collecting preview
    // timings even while the strip is still mounting or closed.
    if (metrics.shell_ready_ms && probe.stripHidden) {
      await ensureStripOpen(options.cdp).catch(() => undefined)
      continue
    }

    if (!metrics.thumb_fallback_visible_ms && probe.thumbIframeCount > 0) {
      metrics.thumb_fallback_visible_ms = Number(elapsed.toFixed(1))
    }

    if (!metrics.thumb_png_first_src_ms && probe.thumbImagesReady > 0) {
      metrics.thumb_png_first_src_ms = Number(elapsed.toFixed(1))
    }

    if (!metrics.thumb_png_first_decoded_ms && probe.thumbImagesDecoded > 0) {
      metrics.thumb_png_first_decoded_ms = Number(elapsed.toFixed(1))
    }

    if (
      metrics.preview_active_slide_ms &&
      expectedShellVersionVisible &&
      !metrics.thumb_png_visible_decoded_ms &&
      probe.thumbImagesReady >= visibleThumbTarget
    ) {
      const decoded =
        probe.thumbImagesDecoded >= visibleThumbTarget
          ? probe.thumbImagesDecoded
          : await decodeReadyThumbnailImages(options.cdp).catch(() => probe.thumbImagesDecoded)

      if (decoded >= visibleThumbTarget) {
        metrics.thumb_png_visible_decoded_ms = Number(elapsed.toFixed(1))
      }
    }

    const coreReady =
      metrics.shell_ready_ms && metrics.preview_active_slide_ms && metrics.preview_loading_clear_ms

    if (coreReady && metrics.thumb_png_visible_decoded_ms) {
      break
    }

    // Stop waiting on decode once the soft deadline passes, if core shell checks passed.
    if (coreReady && Date.now() >= decodeSoftDeadline) {
      break
    }

    await sleep(BENCHMARK_POLL_MS)
  }

  if (!metrics.shell_ready_ms || !metrics.preview_active_slide_ms) {
    throw new Error(
      `Timed out measuring rapid version burst shell path for ${options.fixture.id}. Collected metrics: ${JSON.stringify(metrics)}`,
    )
  }

  if (!metrics.thumb_png_visible_decoded_ms) {
    console.warn(
      `[rapid_version_burst/${options.fixture.id}] shell PNG decode incomplete (best-effort); continuing with API metric.`,
    )
  }

  const finalProbe = await readShellProbe(options.cdp).catch(() => null)
  if (finalProbe) {
    metrics.status_request_count = finalProbe.statusRequestCount
    metrics.preview_session_count = finalProbe.previewSessionCount
    metrics.mounted_iframe_peak = Math.max(peakIframes, finalProbe.thumbIframeCount)
    metrics.dom_parser_count = finalProbe.domParserCount
    metrics.dom_parser_total_ms = Number(finalProbe.domParserTotalMs.toFixed(1))
    metrics.long_task_count = finalProbe.longTaskCount
    metrics.long_task_total_ms = Number(finalProbe.longTaskTotalMs.toFixed(1))
    metrics.long_task_max_ms = Number(finalProbe.longTaskMaxMs.toFixed(1))
  } else {
    metrics.mounted_iframe_peak = peakIframes
  }
  metrics.thumbnail_render_count = countThumbnailRenders(options.observabilityEntries)

  return {
    metrics,
    observability: collectBenchmarkObservability(options.observabilityEntries),
  }
}

export async function writeBenchmarkRun(outputPath: string, result: BenchmarkRunResult) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}
