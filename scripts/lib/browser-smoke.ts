import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import net from 'node:net'
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

export type RuntimeContext = {
  id: number
  isDefault: boolean
  sessionId: string | null
}

export type BrowserProcess = {
  process: ChildProcessWithoutNullStreams
  userDataDir: string
  debugPort: number
  stderr: () => string
}

export type SmokeArtifacts = {
  dir: string
  wroteFiles: string[]
  errors: string[]
}

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SMOKE_WAIT_TIMEOUT_MS = process.env.CI ? 60_000 : 15_000
export const SMOKE_SLOW_TIMEOUT_MS = process.env.CI ? 60_000 : 45_000

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitFor<T>(
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

export function getFreePort() {
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

export function findChromium() {
  const candidates = [
    process.env.ARK_CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter((candidate): candidate is string => Boolean(candidate))

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export async function spawnChromium(
  debugPort: number,
  userDataDir: string,
): Promise<BrowserProcess> {
  const executable = findChromium()

  if (!executable) {
    throw new Error(
      'Chromium was not found. Set ARK_CHROMIUM_PATH to a Chromium-compatible browser binary.',
    )
  }

  let stderr = ''
  const STDERR_CAP = 64_000
  const child = spawn(
    executable,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${userDataDir}`,
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-default-browser-check',
      '--no-first-run',
      '--no-sandbox',
      'about:blank',
    ],
    // Ignore stdout so a chatty Chromium cannot fill the pipe buffer and stall.
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )

  child.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length >= STDERR_CAP) {
      return
    }

    stderr += chunk.toString('utf8')

    if (stderr.length > STDERR_CAP) {
      stderr = `${stderr.slice(0, STDERR_CAP)}\n…[stderr truncated]`
    }
  })

  try {
    await waitFor(
      'Chromium DevTools endpoint',
      async () => {
        if (child.exitCode !== null) {
          throw new Error(`Chromium exited early.\n${stderr}`)
        }

        const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null)
        return Boolean(response?.ok)
      },
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )
  } catch (error) {
    if (child.exitCode === null) {
      child.kill('SIGKILL')
    }

    throw error
  }

  return {
    process: child,
    userDataDir,
    debugPort,
    stderr: () => stderr,
  }
}

export async function stopChromium(browser: BrowserProcess | null) {
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

export class CdpClient {
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
    // Drop pending callbacks without rejecting so teardown does not surface
    // unhandledRejection noise after the smoke assertions have already passed.
    this.callbacks.clear()
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

export async function createPage(debugPort: number) {
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

export async function evaluate<T>(
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

export function readContext(params: unknown, sessionId: string | null): RuntimeContext | null {
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

export async function findContextByUrl(
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

  try {
    const targets = await cdp.send<{
      targetInfos: Array<{ targetId?: string; type?: string; url?: string }>
    }>('Target.getTargets')
    const target = targets.targetInfos.find(
      (entry) =>
        entry.url === url &&
        typeof entry.targetId === 'string' &&
        (entry.type === 'iframe' || entry.type === 'page'),
    )

    if (!target?.targetId) {
      return null
    }

    const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    })

    if (!attached.sessionId) {
      return null
    }

    await cdp.send('Runtime.enable', {}, attached.sessionId)
    await cdp.send('Page.enable', {}, attached.sessionId).catch(() => undefined)
    await cdp.send('Runtime.runIfWaitingForDebugger', {}, attached.sessionId).catch(() => undefined)

    const href = await evaluate<string>(cdp, 'location.href', {
      sessionId: attached.sessionId,
    })

    if (href === url) {
      return {
        id: 0,
        isDefault: true,
        sessionId: attached.sessionId,
      }
    }
  } catch {
    // Target lookup is a best-effort fallback for iframe reload races.
  }

  return null
}

export async function setUploadFile(cdp: CdpClient, fixturePath: string) {
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

function safeFilename(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80)
}

async function captureScreenshotPng(cdp: CdpClient) {
  const result = await cdp.send<{ data?: string }>('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  })
  return result.data ? Buffer.from(result.data, 'base64') : null
}

async function tryWriteFile(
  targetPath: string,
  contents: string | Buffer,
  state: { wroteFiles: string[]; errors: string[] },
) {
  try {
    await writeFile(targetPath, contents)
    state.wroteFiles.push(targetPath)
  } catch (error) {
    state.errors.push(
      `write ${path.basename(targetPath)}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function writeBrowserSmokeArtifacts(options: {
  label: string
  artifactsRoot: string
  browser: BrowserProcess | null
  cdp: CdpClient | null
  appOrigin: string | null
  mainPreviewSrc: string | null
  presentPreviewSrc?: string | null
  error: unknown
}): Promise<SmokeArtifacts> {
  const wroteFiles: string[] = []
  const errors: string[] = []

  const label = safeFilename(options.label || 'smoke')
  const startedAt = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const dir = path.join(options.artifactsRoot, `${startedAt}-${label}`)

  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    return {
      dir,
      wroteFiles,
      errors: [
        `mkdir ${dir}: ${error instanceof Error ? error.message : String(error)}`,
        ...errors,
      ],
    }
  }

  const errorMessage =
    options.error instanceof Error
      ? (options.error.stack ?? options.error.message)
      : String(options.error)
  await tryWriteFile(path.join(dir, 'error.txt'), `${errorMessage}\n`, { wroteFiles, errors })

  if (options.browser) {
    await tryWriteFile(path.join(dir, 'chromium-stderr.txt'), options.browser.stderr(), {
      wroteFiles,
      errors,
    })
  }

  if (options.cdp) {
    try {
      const png = await captureScreenshotPng(options.cdp)
      if (png) {
        await tryWriteFile(path.join(dir, 'screenshot.png'), png, { wroteFiles, errors })
      }
    } catch (error) {
      errors.push(`screenshot: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      const bodyText = await evaluate<string>(options.cdp, 'document.body?.innerText || ""')
      await tryWriteFile(path.join(dir, 'shell-body-text.txt'), bodyText, { wroteFiles, errors })
    } catch (error) {
      errors.push(`shell body text: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (options.mainPreviewSrc) {
    try {
      const html = await (await fetch(options.mainPreviewSrc)).text()
      await tryWriteFile(path.join(dir, 'sandbox-render.html'), html, { wroteFiles, errors })
    } catch (error) {
      errors.push(`sandbox render html: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (options.presentPreviewSrc) {
    try {
      const html = await (await fetch(options.presentPreviewSrc)).text()
      await tryWriteFile(path.join(dir, 'present-render.html'), html, { wroteFiles, errors })
    } catch (error) {
      errors.push(`present render html: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  await tryWriteFile(
    path.join(dir, 'meta.json'),
    JSON.stringify(
      {
        label: options.label,
        appOrigin: options.appOrigin,
        mainPreviewSrc: options.mainPreviewSrc,
        presentPreviewSrc: options.presentPreviewSrc ?? null,
      },
      null,
      2,
    ),
    { wroteFiles, errors },
  )

  return { dir, wroteFiles, errors }
}

export async function startServers(options: {
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
  // Keep browser smoke focused on preview/bridge behavior; thumbnail rendering
  // has its own Chromium-backed unit tests and would leave a shared browser pool.
  process.env.ARK_THUMBNAIL_RENDERER = 'off'

  const { createPreviewSessionStore } = await import('../../apps/api/preview-sessions.ts')
  const { createDeckStore } = await import('../../apps/api/deck-store.ts')
  const { createChatStore } = await import('../../apps/api/chat-store.ts')
  const { createGenerationJobStore } = await import('../../apps/api/generation-job-store.ts')
  const { createApp } = await import('../../apps/api/app.ts')
  const { createSandboxHost } = await import('../../apps/sandbox/sandbox-host.ts')
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

  const webRoot = path.join(repoRoot, 'apps/web')
  const vite = await createViteServer({
    configFile: path.join(webRoot, 'vite.config.ts'),
    mode: 'development',
    root: webRoot,
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

export async function stopServers(servers: {
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

export function networkIncludesAssetPaths(requestUrls: Map<string, string>, assetPaths: string[]) {
  const urls = [...requestUrls.values()]

  return assetPaths.every((assetPath) => urls.some((url) => url.includes(assetPath)))
}

export async function previewIncludesAssetPaths(
  cdp: CdpClient,
  context: RuntimeContext,
  assetPaths: string[],
) {
  return evaluate<boolean>(
    cdp,
    `(() => {
      const urls = new Set([
        ...performance.getEntriesByType('resource').map((entry) => entry.name),
        ...[...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href),
        ...[...document.querySelectorAll('script[src]')].map((script) => script.src),
        ...[...document.styleSheets].map((sheet) => sheet.href).filter(Boolean),
      ])

      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            const href = rule.href || rule.styleSheet?.href

            if (href) {
              urls.add(href)
            }
          }
        } catch {
          // Cross-origin stylesheets still expose resource timing entries and hrefs.
        }
      }

      const required = ${JSON.stringify(assetPaths)}

      return required.every((assetPath) => [...urls].some((url) => url.includes(assetPath)))
    })()`,
    { contextId: context.id, sessionId: context.sessionId },
  )
}

export function collectExternalRequestUrls(
  requestUrls: Map<string, string>,
  allowedOrigins: string[],
) {
  return [...requestUrls.values()].filter((url) => isExternalRequestUrl(url, allowedOrigins))
}

export function isExternalRequestUrl(url: string, allowedOrigins: string[]) {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol.startsWith('http') &&
      !allowedOrigins.some((origin) => parsed.origin === origin)
    )
  } catch {
    return false
  }
}

export function collectCompletedExternalRequestUrls(
  requestUrls: Map<string, string>,
  completedRequestIds: ReadonlySet<string>,
  allowedOrigins: string[],
) {
  return [...completedRequestIds]
    .map((requestId) => requestUrls.get(requestId))
    .filter((url): url is string => Boolean(url && isExternalRequestUrl(url, allowedOrigins)))
}

export async function attachCdpTargets(cdp: CdpClient) {
  cdp.on('Target.attachedToTarget', (params) => {
    const sessionId = (params as { sessionId?: unknown }).sessionId

    if (typeof sessionId !== 'string') {
      return
    }

    // Iframe targets can detach before these fire-and-forget enables resolve
    // (e.g. preview reload on edit-mode toggle). Ignore stale-session errors so
    // they do not surface as unhandled rejections and fail CI.
    const ignoreDetachedTarget = () => undefined

    void cdp.send('Runtime.enable', {}, sessionId).catch(ignoreDetachedTarget)
    void cdp.send('Page.enable', {}, sessionId).catch(ignoreDetachedTarget)
    void cdp.send('Network.enable', {}, sessionId).catch(ignoreDetachedTarget)
    void cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(ignoreDetachedTarget)
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
}

export async function openApp(cdp: CdpClient, appOrigin: string) {
  await cdp.send('Page.navigate', { url: appOrigin })
  await cdp.waitForEvent('Page.loadEventFired')

  await waitFor('Ark upload control', () =>
    evaluate<boolean>(cdp, `Boolean(document.querySelector('input[type="file"]'))`),
  )
}

export type PresentSlideWaitOptions = {
  cdp: CdpClient
  contexts: Map<string, RuntimeContext>
  sandboxOrigin: string
  expectedSlideText: string
  expectedShellCounter?: string
  activeSlideSelector?: string
  runtimeMarkerSelector?: string
  timeoutMs?: number
}

export type PresentSlideWaitResult = {
  presentPreviewSrc: string
  presentPreview: RuntimeContext
}

/**
 * Re-resolve the Present dialog iframe on every poll. Present remounts can
 * invalidate a previously captured CDP context before slide sync completes.
 */
export async function waitForPresentSlide(
  options: PresentSlideWaitOptions,
): Promise<PresentSlideWaitResult> {
  const activeSlideSelector =
    options.activeSlideSelector ?? 'section.slide.active, section.slide.is-active'
  const runtimeMarkerSelector =
    options.runtimeMarkerSelector ??
    'script[data-ark-preview-nav], script[data-ark-preview-bridge], script[data-ark-preview-reveal]'
  let lastSnapshot: Record<string, unknown> | null = null

  return waitFor(
    'Present mode preserves the current slide',
    async () => {
      const shell = await evaluate<{
        presentSrc: string
        shellCounter: string
        dialogText: string
        bodyText: string
        previewStopped: boolean
      }>(
        options.cdp,
        `(() => {
          const dialog = document.querySelector('[role="dialog"]');
          const iframe = dialog?.querySelector('iframe');
          return {
            presentSrc: iframe?.src || '',
            shellCounter: (dialog?.innerText || '').match(/\\d+\\s*\\/\\s*\\d+/)?.[0] || '',
            dialogText: (dialog?.innerText || '').trim().slice(0, 400),
            bodyText: (document.body?.innerText || '').trim().slice(0, 400),
            previewStopped: (document.body?.innerText || '').includes('Preview stopped'),
          };
        })()`,
      )

      lastSnapshot = shell

      if (shell.previewStopped) {
        throw new Error(
          `Present mode preview was stopped unexpectedly.\n${JSON.stringify(shell, null, 2)}`,
        )
      }

      if (!shell.presentSrc.includes(`${options.sandboxOrigin}/render/`)) {
        return null
      }

      if (
        options.expectedShellCounter &&
        shell.shellCounter &&
        shell.shellCounter !== options.expectedShellCounter
      ) {
        return null
      }

      const presentPreview = await findContextByUrl(options.cdp, options.contexts, shell.presentSrc)

      if (!presentPreview) {
        return null
      }

      const frame = await evaluate<{
        activeText: string
        hasRuntimeMarker: boolean
        hasReveal: boolean
        hasWindowReveal: boolean
      }>(
        options.cdp,
        `(() => {
          const active = document.querySelector(${JSON.stringify(activeSlideSelector)});
          return {
            activeText: (active?.textContent || '').trim(),
            hasRuntimeMarker: Boolean(document.querySelector(${JSON.stringify(runtimeMarkerSelector)})),
            hasReveal: Boolean(document.querySelector('.reveal')),
            hasWindowReveal: typeof window.Reveal !== 'undefined',
          };
        })()`,
        { contextId: presentPreview.id, sessionId: presentPreview.sessionId },
      )

      lastSnapshot = { ...shell, ...frame }

      if (!frame.hasRuntimeMarker) {
        return null
      }

      if (!frame.activeText.includes(options.expectedSlideText)) {
        return null
      }

      if (
        options.expectedShellCounter &&
        shell.shellCounter &&
        shell.shellCounter !== options.expectedShellCounter
      ) {
        return null
      }

      return {
        presentPreviewSrc: shell.presentSrc,
        presentPreview,
      }
    },
    {
      timeoutMs: options.timeoutMs ?? SMOKE_SLOW_TIMEOUT_MS,
      intervalMs: 150,
    },
  ).catch((error: unknown) => {
    const detail = lastSnapshot ? `\nLast snapshot: ${JSON.stringify(lastSnapshot, null, 2)}` : ''
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}${detail}`)
  })
}
