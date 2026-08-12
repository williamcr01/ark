/**
 * Repeatable editor-patch persistence bench (issue #287 P0).
 *
 * Not CI-gated. Measures applyDeckPatches (including live-DOM validation) for
 * the discriminating deck sizes from the manual-editor profile:
 * 100/500 absolute elements, one Reveal, one adoption.
 *
 * Usage: pnpm exec tsx scripts/bench-editor-patch.ts
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import type { DeckPatchOperation } from '@ark/deck-core/deck-patch.ts'

import { applyDeckPatches } from '../apps/api/deck-patch.ts'
import { validateDeckHtmlOnServer } from '../apps/api/deck-validate.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function absoluteDeck(count: number) {
  const els = Array.from({ length: count }, (_, i) => {
    const left = 10 + (i % 20) * 40
    const top = 10 + Math.floor(i / 20) * 30
    return `<div data-ark-id="ark-el-${i}" data-ark-managed="true" style="position:absolute;left:${left}px;top:${top}px;width:80px;height:40px">Item ${i}</div>`
  }).join('\n')
  return `<!DOCTYPE html><html><head><title>Bench ${count}</title></head><body><section class="slide">${els}</section></body></html>`
}

function revealDeck() {
  const fixture = readFileSync(path.join(root, 'test/fixtures/reveal-registry-deck.html'), 'utf8')
  const els = Array.from({ length: 50 }, (_, i) => {
    return `<div data-ark-id="ark-el-${i}" data-ark-managed="true" style="position:absolute;left:${20 + (i % 10) * 40}px;top:${20 + Math.floor(i / 10) * 30}px;width:60px;height:30px">R${i}</div>`
  }).join('\n')
  return fixture.replace('</section>', `${els}</section>`)
}

function adoptionDeck() {
  return `<!DOCTYPE html><html><head><title>Adoption</title></head><body><section class="slide"><h1 data-ark-id="ark-el-title">Title</h1></section></body></html>`
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) {
    return 0
  }

  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]!
}

function bench(name: string, html: string, operations: DeckPatchOperation[], runs = 5) {
  const samples: Array<{ patchMs: number; totalMs: number; reusedValidation: boolean }> = []

  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    const patched = applyDeckPatches(html, operations)
    const t1 = performance.now()

    if (!patched.ok) {
      throw new Error(`${name}: patch failed: ${patched.error}`)
    }

    const validation = patched.validation ?? validateDeckHtmlOnServer(patched.html)
    const t2 = performance.now()

    if (!validation.valid) {
      throw new Error(`${name}: validation failed`)
    }

    samples.push({
      patchMs: t1 - t0,
      totalMs: t2 - t0,
      reusedValidation: Boolean(patched.validation),
    })
  }

  const warmed = samples.slice(1)
  const totals = warmed.map((sample) => sample.totalMs).sort((a, b) => a - b)
  const patches = warmed.map((sample) => sample.patchMs).sort((a, b) => a - b)

  return {
    name,
    runs: warmed.length,
    reusedValidation: warmed.every((sample) => sample.reusedValidation),
    patchMedianMs: Number(percentile(patches, 50).toFixed(1)),
    patchP90Ms: Number(percentile(patches, 90).toFixed(1)),
    totalMedianMs: Number(percentile(totals, 50).toFixed(1)),
    totalP90Ms: Number(percentile(totals, 90).toFixed(1)),
  }
}

const cases: Array<{ name: string; html: string; operations: DeckPatchOperation[] }> = [
  {
    name: 'absolute-100',
    html: absoluteDeck(100),
    operations: [{ op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 }],
  },
  {
    name: 'absolute-500',
    html: absoluteDeck(500),
    operations: [{ op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 }],
  },
  {
    name: 'reveal-50',
    html: revealDeck(),
    operations: [{ op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.4, y: 0.4 }],
  },
  {
    name: 'adoption',
    html: adoptionDeck(),
    operations: [
      {
        op: 'move_element',
        elementId: 'ark-el-title',
        slideIndex: 0,
        x: 0.25,
        y: 0.1,
        width: 0.4,
        height: 0.15,
        spacer: {
          width: 512,
          height: 72,
          marginTop: 0,
          marginRight: 0,
          marginBottom: 24,
          marginLeft: 0,
          display: 'block',
        },
      },
    ],
  },
]

const results = cases.map((testCase) => bench(testCase.name, testCase.html, testCase.operations))
console.log(JSON.stringify({ benchmark: 'editor-patch', results }, null, 2))
