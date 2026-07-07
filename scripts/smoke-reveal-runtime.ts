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
  networkIncludesAssetPaths,
  openApp,
  previewIncludesAssetPaths,
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

const revealFixturePath = path.join(repoRoot, 'src/test/fixtures/reveal-registry-deck.html')
const requiredRuntimeAssetPaths = [
  '/api/runtimes/reveal.js/5.1.0/reveal.js',
  '/api/runtimes/reveal.js/5.1.0/reveal.css',
  '/api/runtimes/reveal.js/5.1.0/theme/white.css',
  '/api/runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/source-sans-pro.css',
]
const requiredRuntimeFontAssetPath =
  '/api/runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/source-sans-pro-regular.woff'

type NetworkFailure = {
  url: string
  errorText: string
  blockedReason?: string
}

async function runSmoke() {
  assert(existsSync(revealFixturePath), `Missing fixture ${revealFixturePath}`)

  const [apiPort, sandboxPort, webPort, debugPort] = await Promise.all([
    getFreePort(),
    getFreePort(),
    getFreePort(),
    getFreePort(),
  ])
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ark-reveal-smoke-'))
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
    const runtimeFailures: NetworkFailure[] = []
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
    cdp.on('Network.loadingFailed', (params) => {
      const requestId = (params as { requestId?: unknown }).requestId
      const errorText = (params as { errorText?: unknown }).errorText
      const blockedReason = (params as { blockedReason?: unknown }).blockedReason
      const url = typeof requestId === 'string' ? requestUrls.get(requestId) : null

      if (url?.includes('/api/runtimes/')) {
        runtimeFailures.push({
          url,
          errorText: typeof errorText === 'string' ? errorText : 'request failed',
          blockedReason: typeof blockedReason === 'string' ? blockedReason : undefined,
        })
      }
    })

    await attachCdpTargets(cdp)
    await openApp(cdp, servers.appOrigin)
    await setUploadFile(cdp, revealFixturePath)

    await waitFor(
      'uploaded Reveal deck in shell',
      async () => {
        const text = await evaluate<string>(cdp!, 'document.body.innerText')
        return text.includes('Reveal Registry Deck') && text.includes('Slide 1 of 2')
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
      renderedPreviewHtml.includes('/api/runtimes/reveal.js/5.1.0/reveal.js'),
      `Sandbox render did not include approved Reveal assets.\n${renderedPreviewHtml.slice(0, 800)}`,
    )

    if (mainPreview.sessionId) {
      await cdp!.send('Runtime.enable', {}, mainPreview.sessionId)
      await cdp!.send('Page.enable', {}, mainPreview.sessionId)
      await cdp!.send('Network.enable', {}, mainPreview.sessionId)
    }

    await waitFor('sandbox preview loading overlay to clear', async () => {
      const loading = await evaluate<boolean>(
        cdp!,
        `document.body.innerText.includes('Loading sandbox preview')`,
      )

      return !loading
    })

    await waitFor(
      'approved runtime asset requests',
      async () => {
        const revealReady = await evaluate<boolean>(
          cdp!,
          `(() => {
            const styles = [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href)
            const scripts = [...document.querySelectorAll('script[src]')].map((script) => script.src)
            return (
              typeof window.Reveal !== 'undefined' &&
              scripts.some((src) => src.includes('/api/runtimes/reveal.js/5.1.0/reveal.js')) &&
              styles.some((href) => href.includes('/api/runtimes/reveal.js/5.1.0/reveal.css'))
            )
          })()`,
          { contextId: mainPreview.id, sessionId: mainPreview.sessionId },
        )

        if (revealReady) {
          return true
        }

        if (networkIncludesAssetPaths(requestUrls, requiredRuntimeAssetPaths)) {
          return true
        }

        return previewIncludesAssetPaths(cdp!, mainPreview, requiredRuntimeAssetPaths)
      },
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )

    await waitFor('Source Sans Pro font load', () =>
      evaluate<boolean>(
        cdp!,
        `document.fonts
          ? document.fonts.load('16px "Source Sans Pro"', 'Ark smoke').then((faces) => faces.length > 0)
          : false`,
        { contextId: mainPreview.id, sessionId: mainPreview.sessionId },
      ),
    )

    await waitFor('approved runtime font request', async () => {
      if (networkIncludesAssetPaths(requestUrls, [requiredRuntimeFontAssetPath])) {
        return true
      }

      return previewIncludesAssetPaths(cdp!, mainPreview, [
        requiredRuntimeFontAssetPath,
        '/api/runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/source-sans-pro.css',
      ])
    })

    assert(
      runtimeFailures.length === 0,
      `Approved runtime asset request failed: ${JSON.stringify(runtimeFailures, null, 2)}`,
    )

    await waitFor('Reveal runtime and styles in preview', async () => {
      return evaluate<boolean>(
        cdp!,
        `(() => {
          const reveal = document.querySelector('.reveal');
          const styles = [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href);
          const scripts = [...document.querySelectorAll('script[src]')].map((script) => script.src);
          return Boolean(
            reveal &&
            getComputedStyle(reveal).position === 'relative' &&
            typeof window.Reveal !== 'undefined' &&
            styles.some((href) => href.includes('/api/runtimes/reveal.js/5.1.0/reveal.css')) &&
            styles.some((href) => href.includes('/api/runtimes/reveal.js/5.1.0/theme/white.css')) &&
            scripts.some((src) => src.includes('/api/runtimes/reveal.js/5.1.0/reveal.js'))
          );
        })()`,
        { contextId: mainPreview.id, sessionId: mainPreview.sessionId },
      )
    })

    await evaluate<boolean>(
      cdp,
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`,
    )

    await waitFor('preview navigation to slide 2', async () => {
      const appText = await evaluate<string>(cdp!, 'document.body.innerText')
      const frameActive = await evaluate<boolean>(
        cdp!,
        `(() => {
          const present = document.querySelector('.reveal .slides section.present');
          return Boolean(
            present &&
            (present.textContent || '').includes('Registry-served libraries only')
          );
        })()`,
        { contextId: mainPreview.id, sessionId: mainPreview.sessionId },
      )

      return appText.includes('Slide 2 of 2') && frameActive
    })

    const thumbnails = await waitFor('Reveal thumbnails', () =>
      evaluate<
        Array<{
          title: string
          sandbox: string | null
          hasRevealCss: boolean
          hasThemeCss: boolean
          hasRevealShim: boolean
          hasScript: boolean
          hasCsp: boolean
        }>
      >(
        cdp!,
        `Array.from(document.querySelectorAll('iframe[title$="thumbnail"]')).map((frame) => ({
          title: frame.title,
          sandbox: frame.getAttribute('sandbox'),
          hasRevealCss:
            frame.srcdoc.includes('data-ark-runtime-css="reveal.js@5.1.0/reveal.css"') ||
            frame.srcdoc.includes('/api/runtimes/reveal.js/5.1.0/reveal.css'),
          hasThemeCss:
            frame.srcdoc.includes('data-ark-runtime-css="reveal.js@5.1.0/theme/white.css"') ||
            frame.srcdoc.includes('/api/runtimes/reveal.js/5.1.0/theme/white.css'),
          hasRevealShim: frame.srcdoc.includes('data-ark-reveal-thumb-shim'),
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
          thumbnail.hasRevealCss &&
          thumbnail.hasThemeCss &&
          thumbnail.hasRevealShim &&
          !thumbnail.hasScript &&
          thumbnail.hasCsp,
      ),
      `Reveal thumbnails were not locked down and styled as expected: ${JSON.stringify(thumbnails, null, 2)}`,
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

    await waitFor('Present mode preserves current Reveal slide', async () => {
      const snapshot = await evaluate<{
        presentText: string
        hasReveal: boolean
        hasWindowReveal: boolean
      }>(
        cdp!,
        `(() => {
          const present = document.querySelector('.reveal .slides section.present');
          return {
            presentText: (present?.textContent || '').trim(),
            hasReveal: Boolean(document.querySelector('.reveal')),
            hasWindowReveal: typeof window.Reveal !== 'undefined',
          };
        })()`,
        { contextId: presentPreview.id, sessionId: presentPreview.sessionId },
      )

      const isOnSecondSlide = Boolean(
        snapshot.hasReveal &&
        snapshot.hasWindowReveal &&
        snapshot.presentText.includes('Registry-served libraries only'),
      )

      if (!isOnSecondSlide) {
        const dialogText = await evaluate<string>(
          cdp!,
          `document.querySelector('[role="dialog"]')?.innerText || ''`,
        )

        throw new Error(
          `Present frame snapshot: ${JSON.stringify({ ...snapshot, dialogText }, null, 2)}`,
        )
      }

      return true
    })

    const requestedExternalUrls = collectExternalRequestUrls(requestUrls, [
      servers.appOrigin,
      servers.sandboxOrigin,
    ])

    assert(
      requestedExternalUrls.length === 0,
      `Unexpected external network requests: ${requestedExternalUrls.join(', ')}`,
    )

    console.log('Reveal runtime browser smoke passed.')
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
