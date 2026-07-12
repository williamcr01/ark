import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareBenchmarkRuns,
  mutateFixtureHtml,
  summarizeSamples,
  summarizeScenario,
  waitForFinalVersionThumbnailsReady,
  type BenchmarkIterationResult,
  type BenchmarkRunResult,
} from './renderer-benchmark.ts'

test('summarizes samples with median, p90, and MAD', () => {
  const summary = summarizeSamples([10, 12, 11, 40, 13])

  assert.deepEqual(summary, {
    min: 10,
    median: 12,
    p90: 40,
    max: 40,
    mad: 1,
    samples: 5,
  })
})

test('ignores warmup iterations when summarizing a scenario', () => {
  const iterations: BenchmarkIterationResult[] = [
    {
      index: 0,
      warmup: true,
      metrics: { preview_active_slide_ms: 999 },
      observability: {
        thumbnailRenderSucceeded: null,
        previewSessionCreated: null,
        thumbnailStatusReady: null,
      },
    },
    {
      index: 1,
      warmup: false,
      metrics: { preview_active_slide_ms: 100 },
      observability: {
        thumbnailRenderSucceeded: null,
        previewSessionCreated: null,
        thumbnailStatusReady: null,
      },
    },
    {
      index: 2,
      warmup: false,
      metrics: { preview_active_slide_ms: 120 },
      observability: {
        thumbnailRenderSucceeded: null,
        previewSessionCreated: null,
        thumbnailStatusReady: null,
      },
    },
  ]

  const summary = summarizeScenario(iterations)
  assert.equal(summary.preview_active_slide_ms?.median, 100)
  assert.equal(summary.preview_active_slide_ms?.samples, 2)
})

test('flags p90 regressions above threshold', () => {
  const baseline: BenchmarkRunResult = {
    schemaVersion: 1,
    runId: 'baseline',
    createdAt: '2026-07-11T00:00:00.000Z',
    gitSha: null,
    webMode: 'production',
    iterations: 2,
    warmup: 0,
    environment: { node: 'v22', platform: 'linux', arch: 'x64' },
    results: [
      {
        scenario: 'upload_warm',
        fixture: 'plain-css',
        iterations: [],
        summary: {
          preview_active_slide_ms: {
            min: 100,
            median: 100,
            p90: 110,
            max: 110,
            mad: 0,
            samples: 2,
          },
        },
      },
    ],
  }

  const current: BenchmarkRunResult = {
    ...baseline,
    runId: 'current',
    results: [
      {
        scenario: 'upload_warm',
        fixture: 'plain-css',
        iterations: [],
        summary: {
          preview_active_slide_ms: {
            min: 100,
            median: 120,
            p90: 200,
            max: 200,
            mad: 0,
            samples: 2,
          },
        },
      },
    ],
  }

  const comparison = compareBenchmarkRuns(baseline, current)
  assert.equal(comparison.ok, false)
  assert.equal(comparison.failures[0]?.metric, 'preview_active_slide_ms')
})

test('mutates first slide text deterministically', () => {
  const html = '<section class="slide"><h1>Quarterly planning</h1><p>Body</p></section>'
  const once = mutateFixtureHtml(html, 7)
  const twice = mutateFixtureHtml(once, 8)

  assert.match(once, /Quarterly planning · Benchmark mutation 7/)
  assert.match(twice, /Quarterly planning · Benchmark mutation 8/)
  assert.doesNotMatch(twice, /Benchmark mutation 7/)
  assert.match(twice, /<p>Body<\/p>/)
})

test('waitForFinalVersionThumbnailsReady resolves on ready status with slides', async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    if (calls < 2) {
      return new Response(JSON.stringify({ status: 'pending', slides: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    return new Response(
      JSON.stringify({
        status: 'ready',
        slides: [
          { index: 0, url: '/api/decks/d/thumbnails/v/0.png?hash=abc' },
          { index: 1, url: '/api/decks/d/thumbnails/v/1.png?hash=def' },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )
  }) as typeof fetch

  const result = await waitForFinalVersionThumbnailsReady({
    apiOrigin: 'http://127.0.0.1:9',
    deckId: 'd',
    versionId: 'v',
    expectedSlideCount: 2,
    timeoutMs: 5_000,
    waitMs: 0,
    fetchImpl,
  })

  assert.equal(calls, 2)
  assert.equal(result.slideCount, 2)
  assert.ok(result.readyMs >= 0)
})

test('waitForFinalVersionThumbnailsReady rejects failed status', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ status: 'failed', slides: [], error: 'boom' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

  await assert.rejects(
    () =>
      waitForFinalVersionThumbnailsReady({
        apiOrigin: 'http://127.0.0.1:9',
        deckId: 'd',
        versionId: 'v',
        expectedSlideCount: 1,
        timeoutMs: 1_000,
        waitMs: 0,
        fetchImpl,
      }),
    /boom|failed/i,
  )
})
