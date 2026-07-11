import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createApp } from '../apps/api/app.ts'
import { createPreviewSessionStore } from '../apps/api/preview-sessions.ts'
import { createThumbnailRenderer } from '../apps/api/thumbnails/renderer.ts'
import { getFreePort, repoRoot, waitFor } from './lib/browser-smoke.ts'
import { buildRevealFixtureHtml } from './lib/renderer-benchmark.ts'

const SETTLE_VALUES_MS = [0, 40, 80, 120] as const
const REFERENCE_SETTLE_MS = 120

type SettleMs = (typeof SETTLE_VALUES_MS)[number]

type Fixture = {
  id: string
  html: string
}

type SlideReport = {
  index: number
  bytes: number
  sha256: string
}

type FixtureSettleReport = {
  settleMs: SettleMs
  durationMs: number
  slides: SlideReport[]
  identicalToReference: boolean | null
  differingSlideIndexes: number[]
}

type FixtureReport = {
  fixture: string
  referenceSettleMs: typeof REFERENCE_SETTLE_MS
  results: FixtureSettleReport[]
}

function listen(server: Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function buildRevealFragmentsFixtureHtml() {
  return buildRevealFixtureHtml({ title: 'Reveal Fragments Benchmark', slideCount: 2 }).replace(
    '<p>Benchmark content</p></section>',
    '<p>Benchmark content <span class="fragment">with fragment</span></p></section>',
  )
}

async function loadFixtures(): Promise<Fixture[]> {
  return [
    {
      id: 'plain-css',
      html: await readFile(path.join(repoRoot, 'test/fixtures/plain-css-deck.html'), 'utf8'),
    },
    {
      id: 'reveal-registry',
      html: await readFile(path.join(repoRoot, 'test/fixtures/reveal-registry-deck.html'), 'utf8'),
    },
    {
      id: 'reveal-fragments',
      html: buildRevealFragmentsFixtureHtml(),
    },
  ]
}

async function renderFixtureAtSettle(options: {
  previewSessionStore: ReturnType<typeof createPreviewSessionStore>
  apiOrigin: string
  renderSecret: string
  fixture: Fixture
  settleMs: SettleMs
}) {
  const renderer = createThumbnailRenderer({
    previewSessionStore: options.previewSessionStore,
    apiOrigin: options.apiOrigin,
    renderSecret: options.renderSecret,
    limits: { settleMs: options.settleMs },
  })

  try {
    const result = await renderer.render({
      html: options.fixture.html,
      deckId: `settle-delta-${options.fixture.id}`,
      versionId: `settle-${options.settleMs}`,
    })

    if (!result.ok) {
      throw new Error(`${options.fixture.id} settle=${options.settleMs} failed: ${result.error}`)
    }

    return {
      durationMs: result.durationMs,
      slides: result.slides,
    }
  } finally {
    await renderer.close()
  }
}

function compareSlides(slides: Buffer[], reference: Buffer[]) {
  const differingSlideIndexes: number[] = []
  const max = Math.max(slides.length, reference.length)

  for (let index = 0; index < max; index += 1) {
    if (!slides[index] || !reference[index] || !slides[index]!.equals(reference[index]!)) {
      differingSlideIndexes.push(index)
    }
  }

  return {
    identical: differingSlideIndexes.length === 0,
    differingSlideIndexes,
  }
}

async function main() {
  process.env.ARK_THUMBNAIL_RENDERER = 'on'

  const apiPort = await getFreePort()
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  const previewSessionStore = createPreviewSessionStore()
  const renderSecret = randomBytes(32).toString('hex')
  const app = createApp({
    previewSessionStore,
    thumbnailRenderSecret: renderSecret,
  })
  const server = createServer(app)
  const outputPath = path.join(
    repoRoot,
    'artifacts/renderer-benchmarks',
    `settle-delta-${new Date().toISOString().replaceAll(':', '-')}.json`,
  )

  process.env.PORT = String(apiPort)
  process.env.ARK_API_ORIGIN = apiOrigin

  await listen(server, apiPort)

  try {
    await waitFor('settle-delta API health', async () => {
      const response = await fetch(`${apiOrigin}/api/health`)
      return response.ok
    })

    const fixtures = await loadFixtures()
    const reports: FixtureReport[] = []

    for (const fixture of fixtures) {
      const rendered = new Map<SettleMs, { durationMs: number; slides: Buffer[] }>()

      for (const settleMs of SETTLE_VALUES_MS) {
        console.log(`[settle-delta] rendering ${fixture.id} settle=${settleMs}ms`)
        rendered.set(
          settleMs,
          await renderFixtureAtSettle({
            previewSessionStore,
            apiOrigin,
            renderSecret,
            fixture,
            settleMs,
          }),
        )
      }

      const reference = rendered.get(REFERENCE_SETTLE_MS)

      if (!reference) {
        throw new Error('Missing settle=120 reference render.')
      }

      const results: FixtureSettleReport[] = SETTLE_VALUES_MS.map((settleMs) => {
        const result = rendered.get(settleMs)

        if (!result) {
          throw new Error(`Missing settle=${settleMs} render.`)
        }

        const comparison =
          settleMs === REFERENCE_SETTLE_MS
            ? { identical: true, differingSlideIndexes: [] }
            : compareSlides(result.slides, reference.slides)

        return {
          settleMs,
          durationMs: result.durationMs,
          slides: result.slides.map((slide, index) => ({
            index,
            bytes: slide.byteLength,
            sha256: sha256(slide),
          })),
          identicalToReference: comparison.identical,
          differingSlideIndexes: comparison.differingSlideIndexes,
        }
      })

      reports.push({
        fixture: fixture.id,
        referenceSettleMs: REFERENCE_SETTLE_MS,
        results,
      })
    }

    const payload = {
      createdAt: new Date().toISOString(),
      referenceSettleMs: REFERENCE_SETTLE_MS,
      settleValuesMs: SETTLE_VALUES_MS,
      reports,
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

    console.log('\nSettle delta summary:')
    for (const report of reports) {
      const identical = report.results
        .filter((result) => result.identicalToReference)
        .map((result) => `${result.settleMs}ms`)
        .join(', ')
      console.log(`  ${report.fixture}: byte-identical to 120ms => ${identical}`)
    }
    console.log(`Wrote ${outputPath}`)
  } finally {
    await (app.locals.thumbnailService as { close?: () => Promise<void> } | undefined)?.close?.()
    await closeServer(server)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
