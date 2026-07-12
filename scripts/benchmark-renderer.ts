import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import {
  assert,
  attachCdpTargets,
  buildWebProductionBundle,
  createPage,
  evaluate,
  getFreePort,
  openApp,
  readContext,
  repoRoot,
  spawnChromium,
  startServers,
  stopChromium,
  stopServers,
  waitFor,
  writeBrowserSmokeArtifacts,
  type BrowserSmokeWebMode,
  type RuntimeContext,
  type StartedServers,
} from './lib/browser-smoke.ts'
import { startObservabilityCapture } from './lib/observability-capture.ts'
import {
  BENCHMARK_DEFAULT_ITERATIONS,
  BENCHMARK_DEFAULT_WARMUP,
  BENCHMARK_SCHEMA_VERSION,
  buildPlainFixtureHtml,
  buildRevealFixtureHtml,
  compareBenchmarkRuns,
  formatMetricTable,
  installBenchmarkInstrumentation,
  measureDeckReloadWarmScenario,
  measureRapidVersionBurstScenario,
  measureUploadScenario,
  readActiveDeckIdFromShell,
  summarizeScenario,
  writeBenchmarkRun,
  type BenchmarkFixture,
  type BenchmarkFixtureKind,
  type BenchmarkIterationResult,
  type BenchmarkRunResult,
  type BenchmarkScenarioId,
  type BenchmarkScenarioResult,
} from './lib/renderer-benchmark.ts'

type CliOptions = {
  iterations: number
  warmup: number
  webMode: BrowserSmokeWebMode
  output: string | null
  compare: string | null
  fixtures: BenchmarkFixtureKind[]
  scenarios: BenchmarkScenarioId[]
  extended: boolean
  burstCount: number
  queueConcurrency: number
  settleMs: number | null
}

function printUsage() {
  console.log(`Usage: pnpm benchmark:renderer -- [options]

Options:
  --iterations <n>     Measured iterations per scenario (default ${BENCHMARK_DEFAULT_ITERATIONS})
  --warmup <n>         Discarded warmup iterations (default ${BENCHMARK_DEFAULT_WARMUP})
  --web-mode <mode>    production (default) | development
  --output <path>      Write JSON results to this path
  --compare <path>     Compare against a previous JSON run
  --fixtures <list>    Comma-separated fixture ids
  --scenarios <list>   Comma-separated scenario ids
  --extended           Include large-style + 20-slide fixtures
  --burst-count <n>    PUT versions per rapid_version_burst iteration (default 6)
  --queue-concurrency <n>
                       Thumbnail queue concurrency for the benchmark stack (default 1)
  --settle-ms <n>      Override thumbnail settle delay in milliseconds
  --help               Show this message

Default fixtures: plain-css,reveal-registry,full-js
Default scenarios: upload_cold,upload_warm
`)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    iterations: BENCHMARK_DEFAULT_ITERATIONS,
    warmup: BENCHMARK_DEFAULT_WARMUP,
    webMode: 'production',
    output: null,
    compare: null,
    fixtures: ['plain-css', 'reveal-registry', 'full-js'],
    scenarios: ['upload_cold', 'upload_warm'],
    extended: false,
    burstCount: 6,
    queueConcurrency: 1,
    settleMs: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }

    if (arg === '--') {
      continue
    }

    if (arg === '--extended') {
      options.extended = true
      continue
    }

    const value = argv[index + 1]

    if (arg === '--iterations' && value) {
      options.iterations = Number(value)
      index += 1
      continue
    }

    if (arg === '--warmup' && value) {
      options.warmup = Number(value)
      index += 1
      continue
    }

    if (arg === '--web-mode' && value) {
      assert(value === 'production' || value === 'development', `Invalid web mode: ${value}`)
      options.webMode = value
      index += 1
      continue
    }

    if (arg === '--output' && value) {
      options.output = value
      index += 1
      continue
    }

    if (arg === '--compare' && value) {
      options.compare = value
      index += 1
      continue
    }

    if (arg === '--fixtures' && value) {
      options.fixtures = value.split(',').map((entry) => entry.trim()) as BenchmarkFixtureKind[]
      index += 1
      continue
    }

    if (arg === '--scenarios' && value) {
      options.scenarios = value.split(',').map((entry) => entry.trim()) as BenchmarkScenarioId[]
      index += 1
      continue
    }

    if (arg === '--burst-count' && value) {
      options.burstCount = Number(value)
      index += 1
      continue
    }

    if (arg === '--queue-concurrency' && value) {
      options.queueConcurrency = Number(value)
      index += 1
      continue
    }

    if (arg === '--settle-ms' && value) {
      options.settleMs = Number(value)
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (options.extended) {
    options.fixtures = [
      ...new Set([
        ...options.fixtures,
        'plain-20',
        'reveal-20',
        'large-style',
      ] as BenchmarkFixtureKind[]),
    ]
  }

  assert(options.iterations > 0, '--iterations must be > 0')
  assert(options.warmup >= 0, '--warmup must be >= 0')
  assert(
    Number.isInteger(options.burstCount) && options.burstCount > 0,
    '--burst-count must be > 0',
  )
  assert(
    Number.isInteger(options.queueConcurrency) && options.queueConcurrency > 0,
    '--queue-concurrency must be > 0',
  )
  assert(
    options.settleMs === null || (Number.isInteger(options.settleMs) && options.settleMs >= 0),
    '--settle-ms must be >= 0',
  )

  return options
}

function readGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function nestedDurationMs(
  entry: { durationMs?: number | null; fields?: Record<string, unknown> } | null,
) {
  if (!entry) {
    return null
  }

  if (typeof entry.durationMs === 'number') {
    return entry.durationMs
  }

  const nested = entry.fields?.fields

  if (nested && typeof nested === 'object' && nested !== null && 'durationMs' in nested) {
    const value = (nested as { durationMs?: unknown }).durationMs
    return typeof value === 'number' ? value : null
  }

  return null
}

async function prepareFixtures(tempRoot: string, ids: BenchmarkFixtureKind[]) {
  const fixtures: BenchmarkFixture[] = []

  for (const id of ids) {
    if (id === 'plain-css') {
      fixtures.push({
        id,
        label: 'plain-css',
        title: 'Plain CSS Deck',
        slideCount: 3,
        path: path.join(repoRoot, 'test/fixtures/plain-css-deck.html'),
        activeSlideText: 'Quarterly planning',
        runtime: 'static',
      })
      continue
    }

    if (id === 'reveal-registry') {
      fixtures.push({
        id,
        label: 'reveal-registry',
        title: 'Reveal Registry Deck',
        slideCount: 2,
        path: path.join(repoRoot, 'test/fixtures/reveal-registry-deck.html'),
        activeSlideText: 'Reveal with approved runtime assets',
        runtime: 'reveal',
      })
      continue
    }

    if (id === 'full-js') {
      fixtures.push({
        id,
        label: 'full-js',
        title: 'Full JS Deck',
        slideCount: 2,
        path: path.join(repoRoot, 'test/fixtures/full-js-deck.html'),
        activeSlideText: 'Scripted opening',
        runtime: 'custom-js',
      })
      continue
    }

    if (id === 'plain-20') {
      const fixturePath = path.join(tempRoot, 'plain-20.html')
      await writeFile(
        fixturePath,
        buildPlainFixtureHtml({ title: 'Plain 20 Benchmark', slideCount: 20 }),
        'utf8',
      )
      fixtures.push({
        id,
        label: 'plain-20',
        title: 'Plain 20 Benchmark',
        slideCount: 20,
        path: fixturePath,
        activeSlideText: 'Plain 20 Benchmark slide 1',
        runtime: 'static',
      })
      continue
    }

    if (id === 'reveal-20') {
      const fixturePath = path.join(tempRoot, 'reveal-20.html')
      await writeFile(
        fixturePath,
        buildRevealFixtureHtml({ title: 'Reveal 20 Benchmark', slideCount: 20 }),
        'utf8',
      )
      fixtures.push({
        id,
        label: 'reveal-20',
        title: 'Reveal 20 Benchmark',
        slideCount: 20,
        path: fixturePath,
        activeSlideText: 'Reveal 20 Benchmark',
        runtime: 'reveal',
      })
      continue
    }

    if (id === 'large-style') {
      const fixturePath = path.join(tempRoot, 'large-style.html')
      await writeFile(
        fixturePath,
        buildPlainFixtureHtml({
          title: 'Large Style Benchmark',
          slideCount: 20,
          styleBytes: 400_000,
        }),
        'utf8',
      )
      fixtures.push({
        id,
        label: 'large-style',
        title: 'Large Style Benchmark',
        slideCount: 20,
        path: fixturePath,
        activeSlideText: 'Large Style Benchmark slide 1',
        runtime: 'static',
      })
      continue
    }

    throw new Error(`Unknown fixture id: ${id}`)
  }

  for (const fixture of fixtures) {
    assert(existsSync(fixture.path), `Missing fixture ${fixture.path}`)
  }

  return fixtures
}

async function closeThumbnailService(servers: StartedServers | null) {
  const thumbnailService = servers?.apiApp?.locals?.thumbnailService as
    { close?: () => Promise<void> } | undefined
  await thumbnailService?.close?.().catch(() => undefined)
}

async function bootStack(options: {
  apiPort: number
  sandboxPort: number
  webPort: number
  tempRoot: string
  webMode: BrowserSmokeWebMode
  queueConcurrency: number
  settleMs: number | null
}) {
  const thumbnailCacheDir = path.join(options.tempRoot, 'thumbnails')
  let lastError: unknown

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const servers = await startServers({
        apiPort: options.apiPort,
        sandboxPort: options.sandboxPort,
        webPort: options.webPort,
        tempRoot: options.tempRoot,
        thumbnailRenderer: 'on',
        thumbnailCacheDir,
        thumbnailQueueConcurrency: options.queueConcurrency,
        thumbnailSettleMs: options.settleMs ?? undefined,
        webMode: options.webMode,
      })

      await waitFor('API health', async () => {
        const response = await fetch(`${servers.apiOrigin}/api/health`)
        return response.ok
      })

      await waitFor('web server', async () => {
        const response = await fetch(servers.appOrigin)
        return response.ok
      })

      return servers
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to boot benchmark stack: ${String(lastError)}`)
}

async function runUploadIterations(options: {
  scenario: BenchmarkScenarioId
  fixture: BenchmarkFixture
  iterations: number
  warmup: number
  webMode: BrowserSmokeWebMode
  apiPort: number
  sandboxPort: number
  webPort: number
  artifactsRoot: string
  sharedTempRoot: string
  queueConcurrency: number
  settleMs: number | null
}) {
  const results: BenchmarkIterationResult[] = []
  const total = options.iterations + options.warmup
  const cold = options.scenario === 'upload_cold'

  let sharedServers: StartedServers | null = null
  let sharedBrowser: Awaited<ReturnType<typeof spawnChromium>> | null = null
  let sharedCdp: Awaited<ReturnType<typeof createPage>> | null = null
  let sharedContexts: Map<string, RuntimeContext> | null = null
  let sharedObservability: ReturnType<typeof startObservabilityCapture> | null = null
  const warmTempRoot = path.join(
    options.sharedTempRoot,
    `${options.scenario}-${options.fixture.id}`,
  )

  try {
    if (!cold) {
      await mkdirp(warmTempRoot)
      sharedObservability = startObservabilityCapture()
      sharedServers = await bootStack({
        apiPort: options.apiPort,
        sandboxPort: options.sandboxPort,
        webPort: options.webPort,
        tempRoot: warmTempRoot,
        webMode: options.webMode,
        queueConcurrency: options.queueConcurrency,
        settleMs: options.settleMs,
      })
      sharedBrowser = await spawnChromium(
        await getFreePort(),
        path.join(warmTempRoot, 'chromium-profile'),
      )
      sharedCdp = await createPage(sharedBrowser.debugPort)
      sharedContexts = new Map<string, RuntimeContext>()

      sharedCdp.on('Runtime.executionContextCreated', (params, sessionId) => {
        const context = readContext(params, sessionId)

        if (context && sharedContexts) {
          sharedContexts.set(`${context.sessionId ?? 'root'}:${context.id}`, context)
        }
      })
      sharedCdp.on('Runtime.executionContextDestroyed', (params, sessionId) => {
        const id = (params as { executionContextId?: unknown }).executionContextId

        if (typeof id === 'number' && sharedContexts) {
          sharedContexts.delete(`${sessionId ?? 'root'}:${id}`)
        }
      })

      await attachCdpTargets(sharedCdp)
      await openApp(sharedCdp, sharedServers.appOrigin)
      await installBenchmarkInstrumentation(sharedCdp)
    }

    for (let index = 0; index < total; index += 1) {
      const warmup = index < options.warmup
      let servers = sharedServers
      let browser = sharedBrowser
      let cdp = sharedCdp
      let contexts = sharedContexts
      let observability = sharedObservability
      let iterTempRoot: string | null = null
      let mainPreviewSrc: string | null = null
      let ownsStack = false

      try {
        if (cold) {
          ownsStack = true
          iterTempRoot = await mkdtemp(path.join(os.tmpdir(), 'ark-renderer-bench-iter-'))
          observability = startObservabilityCapture()
          // Reuse the run's ports so the production bundle's baked sandbox origin stays valid.
          servers = await bootStack({
            apiPort: options.apiPort,
            sandboxPort: options.sandboxPort,
            webPort: options.webPort,
            tempRoot: iterTempRoot,
            webMode: options.webMode,
            queueConcurrency: options.queueConcurrency,
            settleMs: options.settleMs,
          })
          browser = await spawnChromium(
            await getFreePort(),
            path.join(iterTempRoot, 'chromium-profile'),
          )
          cdp = await createPage(browser.debugPort)
          contexts = new Map<string, RuntimeContext>()

          cdp.on('Runtime.executionContextCreated', (params, sessionId) => {
            const context = readContext(params, sessionId)

            if (context && contexts) {
              contexts.set(`${context.sessionId ?? 'root'}:${context.id}`, context)
            }
          })
          cdp.on('Runtime.executionContextDestroyed', (params, sessionId) => {
            const id = (params as { executionContextId?: unknown }).executionContextId

            if (typeof id === 'number' && contexts) {
              contexts.delete(`${sessionId ?? 'root'}:${id}`)
            }
          })

          await attachCdpTargets(cdp)
          await openApp(cdp, servers.appOrigin)
          await installBenchmarkInstrumentation(cdp)
        }

        assert(
          servers && browser && cdp && contexts && observability,
          'Benchmark stack was not started.',
        )
        observability.clear()

        // Warm iterations reload the shell so each upload starts from a clean UI state
        // while keeping the API Chromium pool warm.
        if (!cold) {
          await openApp(cdp, servers.appOrigin)
          await installBenchmarkInstrumentation(cdp)
          observability.clear()
        }

        const measured = await measureUploadScenario({
          cdp,
          contexts,
          sandboxOrigin: servers.sandboxOrigin,
          fixture: options.fixture,
          observabilityEntries: observability.entries,
        })

        const probeSrc = await evaluate<string>(
          cdp,
          `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
        )
        mainPreviewSrc = probeSrc || null

        const renderDuration = nestedDurationMs(measured.observability.thumbnailRenderSucceeded)

        if (typeof renderDuration === 'number') {
          measured.metrics.thumbnail_render_duration_ms = renderDuration
        }

        results.push({
          index,
          warmup,
          metrics: measured.metrics,
          observability: measured.observability,
        })

        const label = warmup ? 'warmup' : 'iter'
        console.log(
          `[${options.scenario}/${options.fixture.id}] ${label} ${index + 1}/${total}: preview=${measured.metrics.preview_active_slide_ms?.toFixed(0)}ms thumbs=${measured.metrics.thumb_png_visible_decoded_ms?.toFixed(0)}ms`,
        )
      } catch (error) {
        await writeBrowserSmokeArtifacts({
          label: `renderer-benchmark-${options.scenario}-${options.fixture.id}-${index}`,
          artifactsRoot: options.artifactsRoot,
          browser,
          cdp,
          appOrigin: servers?.appOrigin ?? null,
          mainPreviewSrc,
          error,
        }).catch(() => undefined)
        throw error
      } finally {
        if (ownsStack) {
          observability?.stop()
          cdp?.close()
          await stopChromium(browser)
          await closeThumbnailService(servers)
          if (servers) {
            await stopServers(servers)
          }
          if (iterTempRoot) {
            await rm(iterTempRoot, { recursive: true, force: true }).catch(() => undefined)
          }
        }
      }
    }
  } finally {
    sharedObservability?.stop()
    sharedCdp?.close()
    await stopChromium(sharedBrowser)
    await closeThumbnailService(sharedServers)
    if (sharedServers) {
      await stopServers(sharedServers)
    }
  }

  return results
}

async function runDeckReloadWarmIterations(options: {
  fixture: BenchmarkFixture
  iterations: number
  warmup: number
  webMode: BrowserSmokeWebMode
  apiPort: number
  sandboxPort: number
  webPort: number
  artifactsRoot: string
  sharedTempRoot: string
  queueConcurrency: number
  settleMs: number | null
}) {
  const results: BenchmarkIterationResult[] = []
  const total = options.iterations + options.warmup
  const warmTempRoot = path.join(options.sharedTempRoot, `deck_reload_warm-${options.fixture.id}`)
  let servers: StartedServers | null = null
  let browser: Awaited<ReturnType<typeof spawnChromium>> | null = null
  let cdp: Awaited<ReturnType<typeof createPage>> | null = null
  let contexts: Map<string, RuntimeContext> | null = null
  let observability: ReturnType<typeof startObservabilityCapture> | null = null
  let mainPreviewSrc: string | null = null

  try {
    await mkdirp(warmTempRoot)
    observability = startObservabilityCapture()
    servers = await bootStack({
      apiPort: options.apiPort,
      sandboxPort: options.sandboxPort,
      webPort: options.webPort,
      tempRoot: warmTempRoot,
      webMode: options.webMode,
      queueConcurrency: options.queueConcurrency,
      settleMs: options.settleMs,
    })
    browser = await spawnChromium(await getFreePort(), path.join(warmTempRoot, 'chromium-profile'))
    cdp = await createPage(browser.debugPort)
    contexts = new Map<string, RuntimeContext>()

    cdp.on('Runtime.executionContextCreated', (params, sessionId) => {
      const context = readContext(params, sessionId)

      if (context && contexts) {
        contexts.set(`${context.sessionId ?? 'root'}:${context.id}`, context)
      }
    })
    cdp.on('Runtime.executionContextDestroyed', (params, sessionId) => {
      const id = (params as { executionContextId?: unknown }).executionContextId

      if (typeof id === 'number' && contexts) {
        contexts.delete(`${sessionId ?? 'root'}:${id}`)
      }
    })

    await attachCdpTargets(cdp)
    await openApp(cdp, servers.appOrigin)
    await installBenchmarkInstrumentation(cdp)

    observability.clear()
    const setup = await measureUploadScenario({
      cdp,
      contexts,
      sandboxOrigin: servers.sandboxOrigin,
      fixture: options.fixture,
      observabilityEntries: observability.entries,
    })
    console.log(
      `[deck_reload_warm/${options.fixture.id}] setup: preview=${setup.metrics.preview_active_slide_ms?.toFixed(0)}ms thumbs=${setup.metrics.thumb_png_visible_decoded_ms?.toFixed(0)}ms`,
    )

    for (let index = 0; index < total; index += 1) {
      const warmup = index < options.warmup

      try {
        assert(servers && cdp && contexts && observability, 'Benchmark stack was not started.')
        observability.clear()
        const measured = await measureDeckReloadWarmScenario({
          cdp,
          contexts,
          appOrigin: servers.appOrigin,
          sandboxOrigin: servers.sandboxOrigin,
          fixture: options.fixture,
          observabilityEntries: observability.entries,
        })

        mainPreviewSrc =
          (await evaluate<string>(
            cdp,
            `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
          )) || null

        results.push({
          index,
          warmup,
          metrics: measured.metrics,
          observability: measured.observability,
        })

        const label = warmup ? 'warmup' : 'iter'
        console.log(
          `[deck_reload_warm/${options.fixture.id}] ${label} ${index + 1}/${total}: shell=${measured.metrics.shell_ready_ms?.toFixed(0)}ms thumbs=${measured.metrics.thumb_png_visible_decoded_ms?.toFixed(0)}ms renders=${measured.metrics.thumbnail_render_count ?? 0}`,
        )
      } catch (error) {
        await writeBrowserSmokeArtifacts({
          label: `renderer-benchmark-deck_reload_warm-${options.fixture.id}-${index}`,
          artifactsRoot: options.artifactsRoot,
          browser,
          cdp,
          appOrigin: servers?.appOrigin ?? null,
          mainPreviewSrc,
          error,
        }).catch(() => undefined)
        throw error
      }
    }
  } finally {
    observability?.stop()
    cdp?.close()
    await stopChromium(browser)
    await closeThumbnailService(servers)
    if (servers) {
      await stopServers(servers)
    }
  }

  return results
}

async function runRapidVersionBurstIterations(options: {
  fixture: BenchmarkFixture
  iterations: number
  warmup: number
  webMode: BrowserSmokeWebMode
  apiPort: number
  sandboxPort: number
  webPort: number
  artifactsRoot: string
  sharedTempRoot: string
  queueConcurrency: number
  settleMs: number | null
  burstCount: number
}) {
  const results: BenchmarkIterationResult[] = []
  const total = options.iterations + options.warmup
  const warmTempRoot = path.join(
    options.sharedTempRoot,
    `rapid_version_burst-${options.fixture.id}`,
  )
  const baseHtml = await readFile(options.fixture.path, 'utf8')
  let servers: StartedServers | null = null
  let browser: Awaited<ReturnType<typeof spawnChromium>> | null = null
  let cdp: Awaited<ReturnType<typeof createPage>> | null = null
  let contexts: Map<string, RuntimeContext> | null = null
  let observability: ReturnType<typeof startObservabilityCapture> | null = null
  let mainPreviewSrc: string | null = null

  try {
    await mkdirp(warmTempRoot)
    observability = startObservabilityCapture()
    servers = await bootStack({
      apiPort: options.apiPort,
      sandboxPort: options.sandboxPort,
      webPort: options.webPort,
      tempRoot: warmTempRoot,
      webMode: options.webMode,
      queueConcurrency: options.queueConcurrency,
      settleMs: options.settleMs,
    })
    browser = await spawnChromium(await getFreePort(), path.join(warmTempRoot, 'chromium-profile'))
    cdp = await createPage(browser.debugPort)
    contexts = new Map<string, RuntimeContext>()

    cdp.on('Runtime.executionContextCreated', (params, sessionId) => {
      const context = readContext(params, sessionId)

      if (context && contexts) {
        contexts.set(`${context.sessionId ?? 'root'}:${context.id}`, context)
      }
    })
    cdp.on('Runtime.executionContextDestroyed', (params, sessionId) => {
      const id = (params as { executionContextId?: unknown }).executionContextId

      if (typeof id === 'number' && contexts) {
        contexts.delete(`${sessionId ?? 'root'}:${id}`)
      }
    })

    await attachCdpTargets(cdp)
    await openApp(cdp, servers.appOrigin)
    await installBenchmarkInstrumentation(cdp)

    observability.clear()
    const setup = await measureUploadScenario({
      cdp,
      contexts,
      sandboxOrigin: servers.sandboxOrigin,
      fixture: options.fixture,
      observabilityEntries: observability.entries,
    })
    const deckId = await readActiveDeckIdFromShell(cdp)
    assert(deckId, 'Could not read active deck id after benchmark setup upload.')
    console.log(
      `[rapid_version_burst/${options.fixture.id}] setup: preview=${setup.metrics.preview_active_slide_ms?.toFixed(0)}ms thumbs=${setup.metrics.thumb_png_visible_decoded_ms?.toFixed(0)}ms deck=${deckId}`,
    )

    for (let index = 0; index < total; index += 1) {
      const warmup = index < options.warmup

      try {
        assert(servers && cdp && contexts && observability, 'Benchmark stack was not started.')
        observability.clear()
        const measured = await measureRapidVersionBurstScenario({
          cdp,
          contexts,
          appOrigin: servers.appOrigin,
          apiOrigin: servers.apiOrigin,
          sandboxOrigin: servers.sandboxOrigin,
          deckId,
          baseHtml,
          fixture: options.fixture,
          burstCount: options.burstCount,
          mutationStartIndex: index * options.burstCount,
          observabilityEntries: observability.entries,
        })

        mainPreviewSrc =
          (await evaluate<string>(
            cdp,
            `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
          )) || null

        results.push({
          index,
          warmup,
          metrics: measured.metrics,
          observability: measured.observability,
        })

        const label = warmup ? 'warmup' : 'iter'
        console.log(
          `[rapid_version_burst/${options.fixture.id}] ${label} ${index + 1}/${total}: burst=${measured.metrics.burst_submit_ms?.toFixed(0)}ms finalThumbs=${measured.metrics.final_version_thumb_ready_ms?.toFixed(0)}ms renders=${measured.metrics.thumbnail_render_count ?? 0}`,
        )
      } catch (error) {
        await writeBrowserSmokeArtifacts({
          label: `renderer-benchmark-rapid_version_burst-${options.fixture.id}-${index}`,
          artifactsRoot: options.artifactsRoot,
          browser,
          cdp,
          appOrigin: servers?.appOrigin ?? null,
          mainPreviewSrc,
          error,
        }).catch(() => undefined)
        throw error
      }
    }
  } finally {
    observability?.stop()
    cdp?.close()
    await stopChromium(browser)
    await closeThumbnailService(servers)
    if (servers) {
      await stopServers(servers)
    }
  }

  return results
}

async function mkdirp(dir: string) {
  await mkdir(dir, { recursive: true })
}

async function runBenchmark(options: CliOptions) {
  // Local benchmarks should not inherit CI smoke timeout inflation.
  delete process.env.CI

  const [apiPort, sandboxPort, webPort] = await Promise.all([
    getFreePort(),
    getFreePort(),
    getFreePort(),
  ])
  const sharedTempRoot = await mkdtemp(path.join(os.tmpdir(), 'ark-renderer-bench-'))
  const artifactsRoot =
    process.env.ARK_SMOKE_ARTIFACTS_DIR?.trim() ||
    path.join(
      repoRoot,
      'artifacts/renderer-benchmarks',
      new Date().toISOString().replaceAll(':', '-'),
    )
  await mkdirp(artifactsRoot)

  const fixtures = await prepareFixtures(sharedTempRoot, options.fixtures)
  const appOrigin = `http://127.0.0.1:${webPort}`
  const sandboxOrigin = `http://127.0.0.1:${sandboxPort}`

  if (options.webMode === 'production') {
    console.log(`Building production web bundle for ${appOrigin} / ${sandboxOrigin}…`)
    const buildStarted = performance.now()
    await buildWebProductionBundle({ appOrigin, sandboxOrigin })
    console.log(`Production build finished in ${(performance.now() - buildStarted).toFixed(0)}ms`)
  }

  const scenarioResults: BenchmarkScenarioResult[] = []

  try {
    for (const scenario of options.scenarios) {
      for (const fixture of fixtures) {
        console.log(`\n=== ${scenario}/${fixture.id} ===`)
        const iterations =
          scenario === 'upload_cold' || scenario === 'upload_warm'
            ? await runUploadIterations({
                scenario,
                fixture,
                iterations: options.iterations,
                warmup: options.warmup,
                webMode: options.webMode,
                apiPort,
                sandboxPort,
                webPort,
                artifactsRoot,
                sharedTempRoot,
                queueConcurrency: options.queueConcurrency,
                settleMs: options.settleMs,
              })
            : scenario === 'deck_reload_warm'
              ? await runDeckReloadWarmIterations({
                  fixture,
                  iterations: options.iterations,
                  warmup: options.warmup,
                  webMode: options.webMode,
                  apiPort,
                  sandboxPort,
                  webPort,
                  artifactsRoot,
                  sharedTempRoot,
                  queueConcurrency: options.queueConcurrency,
                  settleMs: options.settleMs,
                })
              : await runRapidVersionBurstIterations({
                  fixture,
                  iterations: options.iterations,
                  warmup: options.warmup,
                  webMode: options.webMode,
                  apiPort,
                  sandboxPort,
                  webPort,
                  artifactsRoot,
                  sharedTempRoot,
                  queueConcurrency: options.queueConcurrency,
                  settleMs: options.settleMs,
                  burstCount: options.burstCount,
                })

        scenarioResults.push({
          scenario,
          fixture: fixture.id,
          iterations,
          summary: summarizeScenario(iterations),
        })
      }
    }
  } finally {
    await rm(sharedTempRoot, { recursive: true, force: true }).catch(() => undefined)
  }

  const runId = `${new Date().toISOString().replaceAll(':', '-')}-${readGitSha() ?? 'nogit'}`
  const result: BenchmarkRunResult = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    gitSha: readGitSha(),
    webMode: options.webMode,
    iterations: options.iterations,
    warmup: options.warmup,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    results: scenarioResults,
  }

  const defaultOutput = path.join(artifactsRoot, `${runId}.json`)
  const outputPath = options.output
    ? path.isAbsolute(options.output)
      ? options.output
      : path.join(repoRoot, options.output)
    : defaultOutput

  await writeBenchmarkRun(outputPath, result)
  console.log(`\n${formatMetricTable(result)}`)
  console.log(`Wrote ${outputPath}`)

  if (options.compare) {
    const comparePath = path.isAbsolute(options.compare)
      ? options.compare
      : path.join(repoRoot, options.compare)
    const baseline = JSON.parse(await readFile(comparePath, 'utf8')) as BenchmarkRunResult
    const comparison = compareBenchmarkRuns(baseline, result)

    if (comparison.warnings.length > 0) {
      console.warn('\nBenchmark warnings:')
      for (const warning of comparison.warnings) {
        console.warn(
          `  ${warning.scenario}/${warning.fixture} ${warning.metric} ${warning.kind}: ${warning.baseline.toFixed(1)} -> ${warning.current.toFixed(1)} (+${warning.regressionPct.toFixed(1)}%)`,
        )
      }
    }

    if (!comparison.ok) {
      console.error('\nBenchmark regressions:')
      for (const failure of comparison.failures) {
        console.error(
          `  ${failure.scenario}/${failure.fixture} ${failure.metric} ${failure.kind}: ${failure.baseline.toFixed(1)} -> ${failure.current.toFixed(1)} (+${failure.regressionPct.toFixed(1)}%)`,
        )
      }
      process.exitCode = 1
      return
    }

    console.log('\nCompare: PASS')
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await runBenchmark(options)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
