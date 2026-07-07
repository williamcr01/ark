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
  waitFor,
  type RuntimeContext,
} from './lib/browser-smoke.ts'

const plainCssFixturePath = path.join(repoRoot, 'src/test/fixtures/plain-css-deck.html')

async function runSmoke() {
  assert(existsSync(plainCssFixturePath), `Missing fixture ${plainCssFixturePath}`)

  const [apiPort, sandboxPort, webPort, debugPort] = await Promise.all([
    getFreePort(),
    getFreePort(),
    getFreePort(),
    getFreePort(),
  ])
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ark-plain-css-smoke-'))
  let browser: Awaited<ReturnType<typeof spawnChromium>> | null = null
  let cdp: Awaited<ReturnType<typeof createPage>> | null = null
  let servers: Awaited<ReturnType<typeof startServers>> | null = null

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
    await setUploadFile(cdp, plainCssFixturePath)

    await waitFor(
      'uploaded plain CSS deck in shell',
      async () => {
        const text = await evaluate<string>(cdp!, 'document.body.innerText')
        return text.includes('Plain CSS Deck') && text.includes('Slide 1 of 3')
      },
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )

    const mainPreviewSrc = await waitFor(
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
      renderedPreviewHtml.includes('data-ark-preview-nav'),
      `Sandbox render did not include the CSS-only navigation shim.\n${renderedPreviewHtml.slice(0, 800)}`,
    )
    assert(
      !renderedPreviewHtml.includes('data-ark-preview-bridge'),
      'Plain CSS preview should not opt into full-js bridge mode.',
    )

    await waitFor('sandbox preview loading overlay to clear', async () => {
      const loading = await evaluate<boolean>(
        cdp!,
        `document.body.innerText.includes('Loading sandbox preview')`,
      )

      return !loading
    })

    await waitFor('active slide content in preview frame', async () => {
      return evaluate<boolean>(
        cdp!,
        `(() => {
          const active = document.querySelector('section.slide.active, section.slide.is-active');
          return Boolean(active && (active.textContent || '').includes('Quarterly planning'));
        })()`,
        { contextId: mainPreview.id, sessionId: mainPreview.sessionId },
      )
    })

    await evaluate<boolean>(
      cdp,
      `Boolean(document.querySelector('button[aria-label="Edit mode"]')?.click())`,
    )

    await waitFor('edit mode toolbar', async () =>
      evaluate<boolean>(
        cdp!,
        `Boolean(document.querySelector('[aria-label="Edit mode toolbar"]'))`,
      ),
    )

    const editPreviewSrc = await waitFor(
      'editor-enabled sandbox preview iframe src',
      async () => {
        const src = await evaluate<string>(
          cdp!,
          `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
        )

        return src.startsWith(`${servers!.sandboxOrigin}/render/`) ? src : ''
      },
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )

    const editRenderedPreviewHtml = await (await fetch(editPreviewSrc)).text()
    assert(
      editRenderedPreviewHtml.includes('data-ark-preview-editor'),
      `Edit mode sandbox render did not include the editor bridge shim.\n${editRenderedPreviewHtml.slice(0, 800)}`,
    )

    await evaluate<boolean>(
      cdp,
      `Boolean(document.querySelector('button[aria-label="Preview mode"]')?.click())`,
    )

    await waitFor('preview mode after leaving edit mode', async () =>
      evaluate<boolean>(cdp!, `!document.querySelector('[aria-label="Edit mode toolbar"]')`),
    )

    const previewSrcAfterEdit = await waitFor(
      'sandbox preview iframe src after edit mode',
      async () => {
        const src = await evaluate<string>(
          cdp!,
          `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
        )

        return src.startsWith(`${servers!.sandboxOrigin}/render/`) ? src : ''
      },
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )

    const mainPreviewAfterEdit = await waitFor(
      'main sandbox preview frame context after edit mode',
      () => findContextByUrl(cdp!, contexts, previewSrcAfterEdit),
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
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
          const active = document.querySelector('section.slide.active, section.slide.is-active');
          return Boolean(active && (active.textContent || '').includes('Metrics that moved'));
        })()`,
        { contextId: mainPreviewAfterEdit.id, sessionId: mainPreviewAfterEdit.sessionId },
      )

      return appText.includes('Slide 2 of 3') && frameActive
    })

    const thumbnails = await waitFor('plain CSS thumbnails', () =>
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

    assert(thumbnails.length === 3, `Expected 3 thumbnails, found ${thumbnails.length}.`)
    assert(
      thumbnails.every(
        (thumbnail) =>
          thumbnail.sandbox === '' &&
          thumbnail.hasThumbFill &&
          !thumbnail.hasScript &&
          thumbnail.hasCsp,
      ),
      `Plain CSS thumbnails were not locked down as expected: ${JSON.stringify(thumbnails, null, 2)}`,
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
          const active = document.querySelector('section.slide.active, section.slide.is-active');
          return { activeText: (active?.textContent || '').trim() };
        })()`,
        { contextId: presentPreview.id, sessionId: presentPreview.sessionId },
      )

      return snapshot.activeText.includes('Metrics that moved')
    })

    const requestedExternalUrls = collectExternalRequestUrls(requestUrls, [
      servers.appOrigin,
      servers.sandboxOrigin,
    ])

    assert(
      requestedExternalUrls.length === 0,
      `Unexpected external network requests: ${requestedExternalUrls.join(', ')}`,
    )

    console.log('Plain CSS browser smoke passed.')
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
