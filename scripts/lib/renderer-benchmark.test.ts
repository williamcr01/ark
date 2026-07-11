import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareBenchmarkRuns,
  summarizeSamples,
  summarizeScenario,
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
