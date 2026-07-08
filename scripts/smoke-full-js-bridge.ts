import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  assert,
  attachCdpTargets,
  collectExternalRequestUrls,
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

const fullJsFixturePath = path.join(repoRoot, 'test/fixtures/full-js-deck.html')

async function runSmoke() {
  assert(existsSync(fullJsFixturePath), `Missing fixture ${fullJsFixturePath}`)

  const [apiPort, sandboxPort, webPort, debugPort] = await Promise.all([
    getFreePort(),
    getFreePort(),
    getFreePort(),
    getFreePort(),
  ])
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ark-full-js-smoke-'))
  const artifactsRoot =
    process.env.ARK_SMOKE_ARTIFACTS_DIR?.trim() || path.join(tempRoot, 'artifacts')
  let browser: Awaited<ReturnType<typeof spawnChromium>> | null = null
  let cdp: Awaited<ReturnType<typeof createPage>> | null = null
  let servers: Awaited<ReturnType<typeof startServers>> | null = null
  let mainPreviewSrc: string | null = null

  try {
    servers = await startServers({ apiPort, sandboxPort, webPort, tempRoot })

    await waitFor('API health', async () => {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`)
      return response.ok
    })

    await waitFor('Vite dev server', async () => {
      const response = await fetch(servers.appOrigin)
      return response.ok
    })

    browser = await spawnChromium(debugPort, path.join(tempRoot, 'chromium-profile'))
    cdp = await createPage(browser.debugPort)

    const requestUrls = new Map<string, string>()
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
    cdp.on('Network.requestWillBeSent', (params) => {
      const requestId = (params as { requestId?: unknown }).requestId
      const url = (params as { request?: { url?: unknown } }).request?.url

      if (typeof requestId === 'string' && typeof url === 'string') {
        requestUrls.set(requestId, url)
      }
    })

    await attachCdpTargets(cdp)
    await openApp(cdp, servers.appOrigin)
    await setUploadFile(cdp, fullJsFixturePath)

    await waitFor(
      'uploaded full-js deck in shell',
      async () => {
        const text = await evaluate<string>(cdp!, 'document.body.innerText')
        return (
          text.includes('Full JS Deck') &&
          text.includes('Slide 1 of 2') &&
          text.includes('Scripts running')
        )
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

    const mainPreview = await waitFor(
      'main sandbox preview frame context',
      () => findContextByUrl(cdp!, contexts, mainPreviewSrc),
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )

    const renderedPreviewHtml = await (await fetch(mainPreviewSrc)).text()
    assert(
      renderedPreviewHtml.includes('data-ark-preview-bridge'),
      `Sandbox render did not include the custom full-js bridge.\n${renderedPreviewHtml.slice(0, 800)}`,
    )
    assert(
      !renderedPreviewHtml.includes('data-ark-preview-nav'),
      'Custom full-js preview should not use the CSS-only navigation shim.',
    )
    assert(
      renderedPreviewHtml.includes('window.fullJsDeckBooted = true'),
      'Sandbox render stripped the deck-authored script.',
    )

    if (mainPreview.sessionId) {
      await cdp!.send('Runtime.enable', {}, mainPreview.sessionId)
      await cdp!.send('Page.enable', {}, mainPreview.sessionId)
    }

    await waitFor('sandbox preview loading overlay to clear', async () => {
      const loading = await evaluate<boolean>(
        cdp!,
        `document.body.innerText.includes('Loading sandbox preview')`,
      )

      return !loading
    })

    await waitFor('deck script execution in preview frame', async () =>
      evaluate<boolean>(cdp!, 'window.fullJsDeckBooted === true', {
        contextId: mainPreview.id,
        sessionId: mainPreview.sessionId,
      }),
    )

    await waitFor('active slide content in preview frame', async () =>
      evaluate<boolean>(
        cdp!,
        `(() => {
          const active = document.querySelector('section.slide.active');
          return Boolean(active && (active.textContent || '').includes('Scripted opening'));
        })()`,
        { contextId: mainPreview.id, sessionId: mainPreview.sessionId },
      ),
    )

    await evaluate<boolean>(
      cdp,
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`,
    )

    await waitFor('preview navigation to slide 2', async () => {
      const appText = await evaluate<string>(cdp!, 'document.body.innerText')
      const frameActive = await evaluate<boolean>(
        cdp!,
        `(() => {
          const active = document.querySelector('section.slide.active');
          return Boolean(active && (active.textContent || '').includes('Scripted detail'));
        })()`,
        { contextId: mainPreview.id, sessionId: mainPreview.sessionId },
      )

      return appText.includes('Slide 2 of 2') && frameActive
    })

    const thumbnails = await waitFor('full-js thumbnails', () =>
      evaluate<
        Array<{
          title: string
          sandbox: string | null
          hasThumbFill: boolean
          hasScript: boolean
          hasCsp: boolean
        }>
      >(
        cdp!,
        `Array.from(document.querySelectorAll('iframe[title$="thumbnail"]')).map((frame) => ({
          title: frame.title,
          sandbox: frame.getAttribute('sandbox'),
          hasThumbFill: frame.srcdoc.includes('data-ark-thumb-fill'),
          hasScript: frame.srcdoc.includes('<script'),
          hasCsp: frame.srcdoc.includes('Content-Security-Policy')
        }))`,
      ),
    )

    assert(thumbnails.length === 2, `Expected 2 thumbnails, found ${thumbnails.length}.`)
    assert(
      thumbnails.every(
        (thumbnail) =>
          thumbnail.sandbox === '' &&
          thumbnail.hasThumbFill &&
          !thumbnail.hasScript &&
          thumbnail.hasCsp,
      ),
      `Full-js thumbnails were not locked down as expected: ${JSON.stringify(thumbnails, null, 2)}`,
    )

    await evaluate<boolean>(
      cdp,
      `Boolean(document.querySelector('button[aria-label="Present fullscreen"]')?.click())`,
    )

    const presentFrameSrc = await waitFor('Present mode frame', async () => {
      const src = await evaluate<string>(
        cdp!,
        `document.querySelector('[role="dialog"] iframe')?.src || ''`,
      )

      return src.includes(`${servers!.sandboxOrigin}/render/`) ? src : ''
    })

    const presentPreview = await waitFor('Present mode sandbox frame context', () =>
      findContextByUrl(cdp!, contexts, presentFrameSrc),
    )

    await waitFor('Present mode preserves the current slide', async () => {
      const snapshot = await evaluate<{ activeText: string }>(
        cdp!,
        `(() => {
          const active = document.querySelector('section.slide.active');
          return { activeText: (active?.textContent || '').trim() };
        })()`,
        { contextId: presentPreview.id, sessionId: presentPreview.sessionId },
      )

      return snapshot.activeText.includes('Scripted detail')
    })

    const requestedExternalUrls = collectExternalRequestUrls(requestUrls, [
      servers.appOrigin,
      servers.sandboxOrigin,
    ])

    assert(
      requestedExternalUrls.length === 0,
      `Unexpected external network requests: ${requestedExternalUrls.join(', ')}`,
    )

    console.log('Full-js custom bridge browser smoke passed.')
  } catch (error: unknown) {
    await writeBrowserSmokeArtifacts({
      label: 'full-js-bridge',
      artifactsRoot,
      browser,
      cdp,
      appOrigin: servers?.appOrigin ?? null,
      mainPreviewSrc,
      error,
    })
    throw error
  } finally {
    cdp?.close()
    await stopChromium(browser)

    if (servers) {
      await stopServers(servers)
    }

    await rm(tempRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 250 })
  }
}

runSmoke().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
