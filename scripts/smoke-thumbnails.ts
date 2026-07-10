import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  assert,
  attachCdpTargets,
  createPage,
  evaluate,
  findContextByUrl,
  getFreePort,
  openApp,
  readContext,
  repoRoot,
  setUploadFile,
  SMOKE_SLOW_TIMEOUT_MS,
  spawnChromium,
  startServers,
  stopChromium,
  stopServers,
  writeBrowserSmokeArtifacts,
  waitFor,
  type RuntimeContext,
} from './lib/browser-smoke.ts'

const plainCssFixturePath = path.join(repoRoot, 'test/fixtures/plain-css-deck.html')

async function runSmoke() {
  assert(existsSync(plainCssFixturePath), `Missing fixture ${plainCssFixturePath}`)

  const [apiPort, sandboxPort, webPort, debugPort] = await Promise.all([
    getFreePort(),
    getFreePort(),
    getFreePort(),
    getFreePort(),
  ])
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ark-thumbnail-smoke-'))
  const artifactsRoot =
    process.env.ARK_SMOKE_ARTIFACTS_DIR?.trim() || path.join(tempRoot, 'artifacts')
  let browser: Awaited<ReturnType<typeof spawnChromium>> | null = null
  let cdp: Awaited<ReturnType<typeof createPage>> | null = null
  let servers: Awaited<ReturnType<typeof startServers>> | null = null
  let mainPreviewSrc: string | null = null

  try {
    servers = await startServers({
      apiPort,
      sandboxPort,
      webPort,
      tempRoot,
      thumbnailRenderer: 'on',
    })

    await waitFor('API health', async () => {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`)
      return response.ok
    })

    await waitFor('Vite dev server', async () => {
      const response = await fetch(servers!.appOrigin)
      return response.ok
    })

    browser = await spawnChromium(debugPort, path.join(tempRoot, 'chromium-profile'))
    cdp = await createPage(browser.debugPort)
    const contexts = new Map<string, RuntimeContext>()

    cdp.on('Runtime.executionContextCreated', (params, sessionId) => {
      const context = readContext(params, sessionId)

      if (context) {
        contexts.set(`${context.sessionId ?? 'root'}:${context.id}`, context)
      }
    })
    cdp.on('Runtime.executionContextDestroyed', (params, sessionId) => {
      const id = (params as { executionContextId?: unknown }).executionContextId

      if (typeof id === 'number') {
        contexts.delete(`${sessionId ?? 'root'}:${id}`)
      }
    })

    await attachCdpTargets(cdp)
    await openApp(cdp, servers.appOrigin)
    await setUploadFile(cdp, plainCssFixturePath)

    await waitFor(
      'uploaded plain CSS deck in shell',
      async () => {
        const text = await evaluate<string>(cdp!, 'document.body.innerText')
        return text.includes('Plain CSS Deck') && text.includes('Slide 1 of 3')
      },
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )

    mainPreviewSrc = await waitFor(
      'main sandbox preview iframe src',
      async () => {
        const src = await evaluate<string>(
          cdp!,
          `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
        )
        return src.startsWith(`${servers!.sandboxOrigin}/render/`) ? src : ''
      },
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )

    await waitFor(
      'main sandbox preview frame context',
      () => findContextByUrl(cdp!, contexts, mainPreviewSrc!),
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )

    const renderedThumbnails = await waitFor(
      'sandbox-rendered PNG thumbnails',
      async () => {
        const thumbs = await evaluate<
          Array<{ title: string; tag: string; src: string | null; sandbox: string | null }>
        >(
          cdp!,
          `Array.from(document.querySelectorAll('[title$="thumbnail"]')).map((node) => ({
            title: node.getAttribute('title') || '',
            tag: node.tagName,
            src: node.getAttribute('src'),
            sandbox: node.getAttribute('sandbox'),
          }))`,
        )

        if (thumbs.length < 3) {
          return null
        }

        const images = thumbs.filter(
          (thumb) =>
            thumb.tag === 'IMG' &&
            typeof thumb.src === 'string' &&
            thumb.src.includes('/thumbnails/') &&
            thumb.src.includes('.png?hash='),
        )

        return images.length >= 3 ? images : null
      },
      { timeoutMs: 90_000 },
    )

    assert(
      renderedThumbnails.length >= 3,
      `Expected rendered PNG thumbnails, found ${JSON.stringify(renderedThumbnails)}`,
    )

    await evaluate<boolean>(
      cdp,
      `Boolean(document.querySelector('button[aria-label="Go to slide 2"]')?.click())`,
    )

    await waitFor('thumbnail click navigates shell to slide 2', async () => {
      const text = await evaluate<string>(cdp!, 'document.body.innerText')
      return text.includes('Slide 2 of 3')
    })

    console.log('smoke:thumbnails passed')
  } catch (error) {
    await writeBrowserSmokeArtifacts({
      label: 'thumbnails',
      artifactsRoot,
      browser,
      cdp,
      appOrigin: servers?.appOrigin ?? null,
      mainPreviewSrc,
      error,
    }).catch(() => undefined)
    throw error
  } finally {
    const thumbnailService = servers?.apiApp?.locals?.thumbnailService as
      { close?: () => Promise<void> } | undefined
    await thumbnailService?.close?.().catch(() => undefined)
    if (cdp) {
      cdp.close()
    }
    await stopChromium(browser)
    if (servers) {
      await stopServers(servers)
    }
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

runSmoke().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
