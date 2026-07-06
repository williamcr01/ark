import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ViteDevServer } from 'vite'

type CdpMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
  sessionId?: string
}

type CdpListener = (params: unknown, sessionId: string | null) => void

type RuntimeContext = {
  id: number
  isDefault: boolean
  sessionId: string | null
}

type NetworkFailure = {
  url: string
  errorText: string
  blockedReason?: string
}

type BrowserProcess = {
  process: ChildProcessWithoutNullStreams
  userDataDir: string
  debugPort: number
  stderr: () => string
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SMOKE_WAIT_TIMEOUT_MS = process.env.CI ? 60_000 : 15_000
const revealFixturePath = path.join(repoRoot, 'src/test/fixtures/reveal-registry-deck.html')
const requiredRuntimeAssetPaths = [
  '/api/runtimes/reveal.js/5.1.0/reveal.js',
  '/api/runtimes/reveal.js/5.1.0/reveal.css',
  '/api/runtimes/reveal.js/5.1.0/theme/white.css',
  '/api/runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/source-sans-pro.css',
]
const requiredRuntimeFontAssetPath =
  '/api/runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/source-sans-pro-regular.woff'
const SMOKE_SLOW_TIMEOUT_MS = 45_000

function networkIncludesAssetPaths(requestUrls: Map<string, string>, assetPaths: string[]) {
  const urls = [...requestUrls.values()]

  return assetPaths.every((assetPath) => urls.some((url) => url.includes(assetPath)))
}

async function previewIncludesAssetPaths(
  cdp: CdpClient,
  context: RuntimeContext,
  assetPaths: string[],
) {
  return evaluate<boolean>(
    cdp,
    `(() => {
      const styles = [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href)
      const scripts = [...document.querySelectorAll('script[src]')].map((script) => script.src)
      const required = ${JSON.stringify(assetPaths)}

      return required.every((assetPath) =>
        styles.some((href) => href.includes(assetPath)) ||
        scripts.some((src) => src.includes(assetPath)),
      )
    })()`,
    { contextId: context.id, sessionId: context.sessionId },
  )
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor<T>(
  label: string,
  callback: () => Promise<T> | T,
  options: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? SMOKE_WAIT_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? 100
  const startedAt = Date.now()
  let lastError: unknown

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await callback()

      if (value) {
        return value
      }
    } catch (error) {
      lastError = error
    }

    await sleep(intervalMs)
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : ''
  throw new Error(`Timed out waiting for ${label}.${suffix}`)
}

function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()

    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a free port.')))
        return
      }

      const port = address.port
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(port)
      })
    })
  })
}

async function listen(server: Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function closeServer(server: Server) {
  if (!server.listening) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function findChromium() {
  const candidates = [
    process.env.ARK_CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter((candidate): candidate is string => Boolean(candidate))

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

async function spawnChromium(debugPort: number, userDataDir: string): Promise<BrowserProcess> {
  const executable = findChromium()

  if (!executable) {
    throw new Error(
      'Chromium was not found. Set ARK_CHROMIUM_PATH to a Chromium-compatible browser binary.',
    )
  }

  let stderr = ''
  const child = spawn(
    executable,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-default-browser-check',
      '--no-first-run',
      '--no-sandbox',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  await waitFor('Chromium DevTools endpoint', async () => {
    if (child.exitCode !== null) {
      throw new Error(`Chromium exited early.\n${stderr}`)
    }

    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null)
    return Boolean(response?.ok)
  })

  return {
    process: child,
    userDataDir,
    debugPort,
    stderr: () => stderr,
  }
}

async function stopChromium(browser: BrowserProcess | null) {
  if (!browser) {
    return
  }

  if (browser.process.exitCode === null) {
    browser.process.kill('SIGTERM')

    await Promise.race([
      new Promise((resolve) => browser.process.once('exit', resolve)),
      sleep(2_000).then(() => {
        if (browser.process.exitCode === null) {
          browser.process.kill('SIGKILL')
        }
      }),
    ])
  }
}

function messageDataToString(data: unknown) {
  if (typeof data === 'string') {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer).toString('utf8')
  }

  return String(data)
}

class CdpClient {
  private callbacks = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
    }
  >()

  private listeners = new Map<string, CdpListener[]>()
  private nextId = 1

  private constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event.data)
    })

    this.socket.addEventListener('close', () => {
      for (const callback of this.callbacks.values()) {
        callback.reject(new Error('CDP socket closed.'))
      }

      this.callbacks.clear()
    })
  }

  static connect(url: string) {
    return new Promise<CdpClient>((resolve, reject) => {
      const socket = new WebSocket(url)

      socket.addEventListener('open', () => {
        resolve(new CdpClient(socket))
      })
      socket.addEventListener('error', () => {
        reject(new Error(`Could not connect to CDP socket ${url}.`))
      })
    })
  }

  close() {
    this.socket.close()
  }

  on(method: string, listener: CdpListener) {
    const listeners = this.listeners.get(method) ?? []
    listeners.push(listener)
    this.listeners.set(method, listeners)
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId: string | null = null,
  ) {
    const id = this.nextId
    this.nextId += 1

    return new Promise<T>((resolve, reject) => {
      this.callbacks.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })

      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  waitForEvent(
    method: string,
    predicate: (params: unknown, sessionId: string | null) => boolean = () => true,
    timeoutMs = SMOKE_WAIT_TIMEOUT_MS,
  ) {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for CDP event ${method}.`))
      }, timeoutMs)

      const listener: CdpListener = (params, sessionId) => {
        if (!predicate(params, sessionId)) {
          return
        }

        clearTimeout(timer)
        const listeners = this.listeners.get(method) ?? []
        this.listeners.set(
          method,
          listeners.filter((entry) => entry !== listener),
        )
        resolve(params)
      }

      this.on(method, listener)
    })
  }

  private handleMessage(data: unknown) {
    const payload = JSON.parse(messageDataToString(data)) as CdpMessage

    if (payload.id) {
      const callback = this.callbacks.get(payload.id)

      if (!callback) {
        return
      }

      this.callbacks.delete(payload.id)

      if (payload.error) {
        callback.reject(new Error(payload.error.message ?? 'CDP command failed.'))
        return
      }

      callback.resolve(payload.result)
      return
    }

    if (!payload.method) {
      return
    }

    for (const listener of this.listeners.get(payload.method) ?? []) {
      listener(payload.params, payload.sessionId ?? null)
    }
  }
}

async function createPage(debugPort: number) {
  const url = `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`
  let response = await fetch(url, { method: 'PUT' })

  if (!response.ok) {
    response = await fetch(url)
  }

  assert(response.ok, `Could not create a Chromium page target: ${response.status}`)
  const target = (await response.json()) as { webSocketDebuggerUrl?: string }

  assert(target.webSocketDebuggerUrl, 'Chromium page target did not expose a CDP socket URL.')
  return CdpClient.connect(target.webSocketDebuggerUrl)
}

async function evaluate<T>(
  cdp: CdpClient,
  expression: string,
  options: { contextId?: number; sessionId?: string | null } = {},
) {
  const result = await cdp.send<{
    result: { value?: unknown; description?: string }
    exceptionDetails?: { text?: string; exception?: { description?: string } }
  }>(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      ...(options.contextId ? { contextId: options.contextId } : {}),
    },
    options.sessionId ?? null,
  )

  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'Runtime evaluation failed.',
    )
  }

  return result.result.value as T
}

function readContext(params: unknown, sessionId: string | null): RuntimeContext | null {
  const context = (params as { context?: unknown }).context as
    | {
        id?: unknown
        auxData?: { isDefault?: unknown }
      }
    | undefined

  if (typeof context?.id !== 'number') {
    return null
  }

  return {
    id: context.id,
    isDefault: context.auxData?.isDefault === true,
    sessionId,
  }
}

async function findContextByUrl(
  cdp: CdpClient,
  contexts: Map<string, RuntimeContext>,
  url: string,
) {
  const defaultContexts = [...contexts.values()].filter((context) => context.isDefault)

  for (const context of defaultContexts) {
    try {
      const href = await evaluate<string>(cdp, 'location.href', {
        contextId: context.id,
        sessionId: context.sessionId,
      })

      if (href === url) {
        return context
      }
    } catch {
      // Contexts can disappear while frames are navigating.
    }
  }

  return null
}

async function setUploadFile(cdp: CdpClient, fixturePath: string) {
  const documentResult = await cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', {
    depth: 1,
  })
  const input = await cdp.send<{ nodeId: number }>('DOM.querySelector', {
    nodeId: documentResult.root.nodeId,
    selector: 'input[type="file"]',
  })

  assert(input.nodeId, 'Upload file input was not found.')

  await cdp.send('DOM.setFileInputFiles', {
    nodeId: input.nodeId,
    files: [fixturePath],
  })

  await evaluate<boolean>(
    cdp,
    `Boolean(document.querySelector('input[type="file"]')?.dispatchEvent(new Event('change', { bubbles: true })))`,
  )
}

async function startServers(options: {
  apiPort: number
  sandboxPort: number
  webPort: number
  tempRoot: string
}) {
  const appOrigin = `http://127.0.0.1:${options.webPort}`
  const apiOrigin = `http://127.0.0.1:${options.apiPort}`
  const sandboxOrigin = `http://127.0.0.1:${options.sandboxPort}`

  process.env.PORT = String(options.apiPort)
  process.env.SANDBOX_PORT = String(options.sandboxPort)
  process.env.ARK_API_ORIGIN = apiOrigin
  process.env.ARK_APP_ORIGIN = appOrigin
  process.env.ARK_SANDBOX_ORIGIN = sandboxOrigin
  process.env.VITE_ARK_APP_ORIGIN = appOrigin
  process.env.VITE_ARK_SANDBOX_ORIGIN = sandboxOrigin
  process.env.VITE_DEV_PORT = String(options.webPort)

  const { createPreviewSessionStore } = await import('../server/preview-sessions.ts')
  const { createDeckStore } = await import('../server/deck-store.ts')
  const { createChatStore } = await import('../server/chat-store.ts')
  const { createGenerationJobStore } = await import('../server/generation-job-store.ts')
  const { createApp } = await import('../server/app.ts')
  const { createSandboxHost } = await import('../server/sandbox-host.ts')
  const { createServer: createViteServer } = await import('vite')

  const previewSessionStore = createPreviewSessionStore()
  const apiApp = createApp({
    deckStore: createDeckStore(path.join(options.tempRoot, 'decks')),
    chatStore: createChatStore(path.join(options.tempRoot, 'chat')),
    generationJobStore: createGenerationJobStore(path.join(options.tempRoot, 'generation-jobs')),
    previewSessionStore,
  })
  const sandboxApp = createSandboxHost({
    previewSessionStore,
    apiOrigin,
  })
  const apiServer = createServer(apiApp)
  const sandboxServer = createServer(sandboxApp)

  await listen(apiServer, options.apiPort)
  await listen(sandboxServer, options.sandboxPort)

  const vite = await createViteServer({
    configFile: path.join(repoRoot, 'vite.config.ts'),
    mode: 'development',
    root: repoRoot,
    server: {
      host: '127.0.0.1',
      port: options.webPort,
      strictPort: true,
    },
  })

  await vite.listen()

  return {
    apiServer,
    sandboxServer,
    vite,
    appOrigin,
    sandboxOrigin,
  }
}

async function stopServers(servers: {
  apiServer?: Server
  sandboxServer?: Server
  vite?: ViteDevServer
}) {
  await Promise.all([
    servers.vite?.close(),
    servers.apiServer ? closeServer(servers.apiServer) : undefined,
    servers.sandboxServer ? closeServer(servers.sandboxServer) : undefined,
  ])
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
  let browser: BrowserProcess | null = null
  let cdp: CdpClient | null = null
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

    cdp.on('Target.attachedToTarget', (params) => {
      const sessionId = (params as { sessionId?: unknown }).sessionId

      if (typeof sessionId !== 'string') {
        return
      }

      void cdp!.send('Runtime.enable', {}, sessionId)
      void cdp!.send('Page.enable', {}, sessionId)
      void cdp!.send('Network.enable', {}, sessionId)
      void cdp!.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
    })

    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: false,
    })
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('DOM.enable')
    await cdp.send('Network.enable')
    await cdp.send('Page.navigate', { url: servers.appOrigin })
    await cdp.waitForEvent('Page.loadEventFired')

    await waitFor('Ark upload control', () =>
      evaluate<boolean>(cdp!, `Boolean(document.querySelector('input[type="file"]'))`),
    )

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

        // Child-frame network events can race CDP attachment on slower CI runners.
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

    const requestedExternalUrls = [...requestUrls.values()].filter((url) => {
      try {
        const parsed = new URL(url)
        return (
          parsed.protocol.startsWith('http') &&
          parsed.origin !== servers!.appOrigin &&
          parsed.origin !== servers!.sandboxOrigin
        )
      } catch {
        return false
      }
    })

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

    await rm(tempRoot, { force: true, recursive: true })
  }
}

runSmoke().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
