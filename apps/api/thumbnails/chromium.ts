import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { createLogger } from '../observability/logger.ts'
import { CHROMIUM_STARTUP_FALLBACK_TIMEOUT_MS, CHROMIUM_STARTUP_TIMEOUT_MS } from './constants.ts'

type CdpMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
  sessionId?: string
}

type CdpListener = (params: unknown, sessionId: string | null) => void

export type ChromiumSandboxMode = 'sandboxed' | 'no-sandbox'

export type ChromiumSandboxFailureClass = 'sandbox' | 'non-sandbox'

const CHROMIUM_SANDBOX_FAILURE_PATTERNS = [
  /no usable sandbox/i,
  /running as root without --no-sandbox/i,
  /sandbox.*not.*configured/i,
  /failed to move to new namespace/i,
  /namespace sandbox/i,
  /sandbox cannot be enabled/i,
  /zygote cannot be disabled if sandbox is enabled/i,
] as const

const CHROMIUM_DEVTOOLS_TIMEOUT_PATTERN = /timed out waiting for chromium devtools endpoint/i

class ChromiumLaunchError extends Error {
  readonly stderr: string
  readonly sandboxMode: ChromiumSandboxMode

  constructor(message: string, options: { stderr: string; sandboxMode: ChromiumSandboxMode }) {
    super(message)
    this.name = 'ChromiumLaunchError'
    this.stderr = options.stderr
    this.sandboxMode = options.sandboxMode
  }
}

/**
 * True when Chromium stderr/error text indicates the host cannot run a sandboxed
 * renderer (the only case where `--no-sandbox` fallback is appropriate).
 */
export function isChromiumSandboxLaunchFailure(stderr: string, error?: unknown): boolean {
  const message = [stderr, error instanceof Error ? error.message : String(error ?? '')]
    .filter(Boolean)
    .join('\n')

  return CHROMIUM_SANDBOX_FAILURE_PATTERNS.some((pattern) => pattern.test(message))
}

export function classifyChromiumLaunchFailure(
  stderr: string,
  error?: unknown,
): ChromiumSandboxFailureClass {
  return isChromiumSandboxLaunchFailure(stderr, error) ? 'sandbox' : 'non-sandbox'
}

function isChromiumDevToolsStartupTimeout(stderr: string, error?: unknown): boolean {
  const message = [stderr, error instanceof Error ? error.message : String(error ?? '')]
    .filter(Boolean)
    .join('\n')

  return CHROMIUM_DEVTOOLS_TIMEOUT_PATTERN.test(message)
}

function canFallbackToNoSandbox(
  sandboxMode: ChromiumSandboxMode,
  stderr: string,
  error: unknown,
): boolean {
  return (
    sandboxMode === 'sandboxed' &&
    (isChromiumSandboxLaunchFailure(stderr, error) ||
      isChromiumDevToolsStartupTimeout(stderr, error))
  )
}

export type BrowserProcess = {
  process: ChildProcess
  userDataDir: string
  debugPort: number
  sandboxMode: ChromiumSandboxMode
  stderr: () => string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

export function isThumbnailRendererDisabled(env: NodeJS.ProcessEnv = process.env) {
  const value = env.ARK_THUMBNAIL_RENDERER?.trim().toLowerCase()

  return value === 'off' || value === '0' || value === 'false' || value === 'disabled'
}

export function isThumbnailRendererForcedOn(env: NodeJS.ProcessEnv = process.env) {
  const value = env.ARK_THUMBNAIL_RENDERER?.trim().toLowerCase()

  return value === 'on' || value === '1' || value === 'true' || value === 'enabled'
}

/**
 * When true, always launch Chromium with `--no-sandbox` (skip the sandboxed probe).
 * Accepts the same truthy tokens as other ARK_* toggles (`true` / `1` / `yes` / `on`).
 */
export function isChromiumNoSandboxForced(env: NodeJS.ProcessEnv = process.env) {
  const value = env.ARK_CHROMIUM_NO_SANDBOX?.trim().toLowerCase()

  return value === 'true' || value === '1' || value === 'yes' || value === 'on'
}

/**
 * Ordered sandbox modes to try when launching Chromium.
 * Forced no-sandbox skips the sandboxed attempt entirely.
 */
export function chromiumSandboxAttemptOrder(
  env: NodeJS.ProcessEnv = process.env,
): ChromiumSandboxMode[] {
  if (isChromiumNoSandboxForced(env)) {
    return ['no-sandbox']
  }

  return ['sandboxed', 'no-sandbox']
}

export function buildChromiumLaunchArgs(
  debugPort: number,
  userDataDir: string,
  options: { noSandbox: boolean },
): string[] {
  const args = [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-default-browser-check',
    '--no-first-run',
  ]

  // Prefer the Chromium sandbox when the host supports it. Containers/CI without
  // user namespaces typically need `--no-sandbox` (forced via env, or as a
  // fallback after a failed sandboxed launch). Trade-off when disabled: a
  // Chromium renderer exploit in hostile deck HTML would escape to the API
  // process user; mitigated by the strict no-network CSP, the loopback-only
  // render routes (plus process-local secret), and per-render page disposal.
  if (options.noSandbox) {
    args.push('--no-sandbox')
  }

  args.push('--disable-popup-blocking', '--block-new-web-contents', 'about:blank')
  return args
}

export function isThumbnailRendererAvailable(env: NodeJS.ProcessEnv = process.env) {
  if (isThumbnailRendererDisabled(env)) {
    return false
  }

  // Keep unit tests free of background Chromium unless explicitly forced on.
  if (env.VITEST && !isThumbnailRendererForcedOn(env)) {
    return false
  }

  return Boolean(findChromium())
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
  private eventWaiters = new Set<{
    reject: (error: Error) => void
    cleanup: () => void
  }>()
  private nextId = 1
  private readonly socket: WebSocket

  private constructor(socket: WebSocket) {
    this.socket = socket
    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event.data)
    })

    this.socket.addEventListener('close', () => {
      this.rejectPending('CDP socket closed.')
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

  private rejectPending(message: string) {
    const closed = new Error(message)

    for (const callback of this.callbacks.values()) {
      callback.reject(closed)
    }

    this.callbacks.clear()

    for (const waiter of this.eventWaiters) {
      waiter.cleanup()
      waiter.reject(closed)
    }

    this.eventWaiters.clear()
    this.listeners.clear()
  }

  close() {
    this.rejectPending('CDP socket closed.')
    this.socket.close()
  }

  /** Drop event listeners so a reused page does not accumulate handlers. */
  clearListeners() {
    this.listeners.clear()
  }

  on(method: string, listener: CdpListener) {
    const listeners = this.listeners.get(method) ?? []
    listeners.push(listener)
    this.listeners.set(method, listeners)

    return () => {
      const current = this.listeners.get(method) ?? []
      this.listeners.set(
        method,
        current.filter((entry) => entry !== listener),
      )
    }
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
    timeoutMs = 15_000,
  ) {
    return new Promise<unknown>((resolve, reject) => {
      let settled = false

      const settle = (action: () => void) => {
        if (settled) {
          return
        }

        settled = true
        action()
      }

      const timer = setTimeout(() => {
        settle(() => {
          this.eventWaiters.delete(entry)
          unsubscribe()
          reject(new Error(`Timed out waiting for CDP event ${method}.`))
        })
      }, timeoutMs)

      const entry = {
        reject: (error: Error) => {
          settle(() => {
            clearTimeout(timer)
            unsubscribe()
            reject(error)
          })
        },
        cleanup: () => {
          clearTimeout(timer)
          unsubscribe()
        },
      }

      const listener: CdpListener = (params, sessionId) => {
        if (!predicate(params, sessionId)) {
          return
        }

        settle(() => {
          clearTimeout(timer)
          this.eventWaiters.delete(entry)
          unsubscribe()
          resolve(params)
        })
      }

      const unsubscribe = this.on(method, listener)
      this.eventWaiters.add(entry)
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

async function waitForDevToolsEndpoint(
  child: ChildProcess,
  debugPort: number,
  getStderr: () => string,
  options: { timeoutMs?: number; signal?: AbortSignal; sandboxMode: ChromiumSandboxMode },
) {
  const timeoutMs = options.timeoutMs ?? CHROMIUM_STARTUP_TIMEOUT_MS
  const intervalMs = 100
  const startedAt = Date.now()
  let exitDetails: { code: number | null; signal: NodeJS.Signals | null } | null = null
  let aborted = false

  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    if (aborted) {
      return
    }

    exitDetails = { code, signal }
  }

  const onAbort = () => {
    aborted = true
    if (child.exitCode === null) {
      child.kill('SIGKILL')
    }
  }

  child.on('exit', onExit)
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (exitDetails) {
        await sleep(50)
        const { code, signal } = exitDetails
        const suffix = signal ? ` (signal ${signal})` : code === null ? '' : ` (code ${code})`
        const stderr = getStderr()
        throw new ChromiumLaunchError(`Chromium exited early${suffix}.\n${stderr}`, {
          stderr,
          sandboxMode: options.sandboxMode,
        })
      }

      if (options.signal?.aborted) {
        throw new Error('Chromium startup aborted.')
      }

      if (child.exitCode !== null) {
        await sleep(50)
        const stderr = getStderr()
        throw new ChromiumLaunchError(`Chromium exited early.\n${stderr}`, {
          stderr,
          sandboxMode: options.sandboxMode,
        })
      }

      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null)

      if (response?.ok) {
        return
      }

      await sleep(intervalMs)
    }

    throw new Error(`Timed out waiting for Chromium DevTools endpoint.\n${getStderr()}`)
  } finally {
    child.off('exit', onExit)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

async function spawnChromiumOnce(
  executable: string,
  debugPort: number,
  userDataDir: string,
  sandboxMode: ChromiumSandboxMode,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<BrowserProcess> {
  let stderr = ''
  const STDERR_CAP = 64_000
  const child = spawn(
    executable,
    buildChromiumLaunchArgs(debugPort, userDataDir, {
      noSandbox: sandboxMode === 'no-sandbox',
    }),
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
    await waitForDevToolsEndpoint(child, debugPort, () => stderr, {
      signal: options.signal,
      sandboxMode,
      timeoutMs: options.timeoutMs,
    })
  } catch (error) {
    if (child.exitCode === null) {
      child.kill('SIGKILL')
    }

    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)

    if (error instanceof ChromiumLaunchError) {
      throw error
    }

    throw new ChromiumLaunchError(
      error instanceof Error ? error.message : 'Chromium failed to start.',
      { stderr, sandboxMode },
    )
  }

  // Do not keep the parent Node process alive solely for the shared Chromium pool.
  // Unref only after DevTools is ready so startup polling stays reliable on CI.
  child.unref()

  return {
    process: child,
    userDataDir,
    debugPort,
    sandboxMode,
    stderr: () => stderr,
  }
}

export async function spawnChromium(
  debugPort: number,
  userDataDir: string,
  options: { signal?: AbortSignal } = {},
): Promise<BrowserProcess> {
  const executable = findChromium()

  if (!executable) {
    throw new Error(
      'Chromium was not found. Set ARK_CHROMIUM_PATH to a Chromium-compatible browser binary.',
    )
  }

  const logger = createLogger({ service: 'ark-api' })
  const attempts = chromiumSandboxAttemptOrder()
  let nextPort = debugPort
  let nextUserDataDir = userDataDir
  let lastError: unknown

  for (let index = 0; index < attempts.length; index += 1) {
    const sandboxMode = attempts[index]!
    const isFallback = index > 0

    if (options.signal?.aborted) {
      throw new Error('Chromium startup aborted.')
    }

    if (isFallback) {
      nextPort = await getFreePort()
      nextUserDataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-chrome-'))
      const stderr =
        lastError instanceof ChromiumLaunchError
          ? lastError.stderr
          : lastError instanceof Error
            ? lastError.message
            : 'sandboxed Chromium launch failed'
      const failureClass = classifyChromiumLaunchFailure(stderr, lastError)
      const reason =
        lastError instanceof Error ? lastError.message : 'sandboxed Chromium launch failed'
      logger.warn('thumbnail.chromium.sandbox_fallback', {
        reason: reason.slice(0, 500),
        sandboxMode,
        failureClass,
      })
    }

    try {
      const timeoutMs =
        sandboxMode === 'no-sandbox'
          ? CHROMIUM_STARTUP_FALLBACK_TIMEOUT_MS
          : CHROMIUM_STARTUP_TIMEOUT_MS
      const browser = await spawnChromiumOnce(executable, nextPort, nextUserDataDir, sandboxMode, {
        ...options,
        timeoutMs,
      })
      logger.info('thumbnail.chromium.started', { sandboxMode })
      return browser
    } catch (error) {
      lastError = error

      const stderr = error instanceof ChromiumLaunchError ? error.stderr : ''
      const canFallback =
        index < attempts.length - 1 && canFallbackToNoSandbox(sandboxMode, stderr, error)

      if (!canFallback) {
        throw error
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Chromium failed to start.')
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

  await rm(browser.userDataDir, { recursive: true, force: true }).catch(() => undefined)
}

export type BrowserPage = {
  cdp: CdpClient
  targetId: string | null
  /** Closes the CDP socket and disposes the page target so tabs never accumulate. */
  close: () => Promise<void>
}

export async function closePageTarget(debugPort: number, targetId: string) {
  await fetch(`http://127.0.0.1:${debugPort}/json/close/${encodeURIComponent(targetId)}`).catch(
    () => undefined,
  )
}

export async function listPageTargets(debugPort: number) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)

  if (!response.ok) {
    throw new Error(`Could not list Chromium page targets: ${response.status}`)
  }

  return (await response.json()) as Array<{ id?: string; type?: string; url?: string }>
}

export async function createPage(debugPort: number): Promise<BrowserPage> {
  const url = `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`
  let response = await fetch(url, { method: 'PUT' })

  if (!response.ok) {
    response = await fetch(url)
  }

  if (!response.ok) {
    throw new Error(`Could not create a Chromium page target: ${response.status}`)
  }

  const target = (await response.json()) as { webSocketDebuggerUrl?: string; id?: string }

  if (!target.webSocketDebuggerUrl) {
    throw new Error('Chromium page target did not expose a CDP socket URL.')
  }

  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl)
  const targetId = target.id ?? null

  return {
    cdp,
    targetId,
    async close() {
      cdp.close()

      if (targetId) {
        await closePageTarget(debugPort, targetId)
      }
    },
  }
}

export async function evaluate<T>(cdp: CdpClient, expression: string) {
  const result = await cdp.send<{
    result: { value?: unknown; description?: string }
    exceptionDetails?: { text?: string; exception?: { description?: string } }
  }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })

  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'Runtime evaluation failed.',
    )
  }

  return result.result.value as T
}

export type ChromiumPool = {
  ensureBrowser: (signal?: AbortSignal) => Promise<BrowserProcess>
  createPage: (signal?: AbortSignal) => Promise<BrowserPage>
  /**
   * Return a page to the pool for reuse, or destroy it after errors/aborts.
   * When omitted (tests), callers should fall back to `page.close()`.
   */
  releasePage?: (page: BrowserPage, options?: { destroy?: boolean }) => Promise<void>
  close: () => Promise<void>
  isAvailable: () => boolean
}

export function createChromiumPool(options: { enabled?: boolean } = {}): ChromiumPool {
  const enabled = options.enabled ?? isThumbnailRendererAvailable()
  let browserPromise: Promise<BrowserProcess> | null = null
  let browser: BrowserProcess | null = null
  let idlePage: BrowserPage | null = null
  /** True while a successful page is resetting into the idle slot. */
  let reservingIdleSlot = false

  const waitForSharedBrowserStartup = (
    promise: Promise<BrowserProcess>,
    signal?: AbortSignal,
  ): Promise<BrowserProcess> => {
    if (signal?.aborted) {
      return Promise.reject(new Error('Chromium startup aborted.'))
    }

    if (!signal) {
      return promise
    }

    return new Promise((resolve, reject) => {
      let settled = false

      const onAbort = () => {
        if (settled) {
          return
        }

        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(new Error('Chromium startup aborted.'))
      }

      const resolveOnce = (nextBrowser: BrowserProcess) => {
        if (settled) {
          return
        }

        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(nextBrowser)
      }

      const rejectOnce = (error: unknown) => {
        if (settled) {
          return
        }

        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }

      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(resolveOnce, rejectOnce)
    })
  }

  const ensureBrowser = async (signal?: AbortSignal) => {
    if (!enabled) {
      throw new Error('Thumbnail renderer is disabled.')
    }

    if (signal?.aborted) {
      throw new Error('Chromium startup aborted.')
    }

    if (browser && browser.process.exitCode === null) {
      return browser
    }

    if (!browserPromise) {
      browserPromise = (async () => {
        const debugPort = await getFreePort()
        const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-chrome-'))
        const nextBrowser = await spawnChromium(debugPort, userDataDir)

        nextBrowser.process.once('exit', () => {
          if (browser === nextBrowser) {
            browser = null
            browserPromise = null
            idlePage = null
            reservingIdleSlot = false
          }
        })

        browser = nextBrowser
        return nextBrowser
      })().catch((error) => {
        browserPromise = null
        browser = null
        idlePage = null
        reservingIdleSlot = false
        throw error
      })
    }

    return waitForSharedBrowserStartup(browserPromise, signal)
  }

  const destroyPage = async (page: BrowserPage) => {
    await page.close().catch(() => undefined)
  }

  const resetPageForReuse = async (page: BrowserPage) => {
    page.cdp.clearListeners()
    // Clear leftover CDP domain state from the previous render (network audit, etc.).
    await page.cdp.send('Network.disable').catch(() => undefined)
    await page.cdp.send('Page.navigate', { url: 'about:blank' })
    await page.cdp.waitForEvent('Page.loadEventFired', () => true, 5_000).catch(() => undefined)
  }

  return {
    isAvailable: () => enabled && Boolean(findChromium()),
    ensureBrowser,
    async createPage(signal?: AbortSignal) {
      const current = await ensureBrowser(signal)
      if (signal?.aborted) {
        throw new Error('Chromium startup aborted.')
      }

      const reusable = idlePage
      idlePage = null

      if (reusable) {
        return reusable
      }

      return createPage(current.debugPort)
    },
    async releasePage(page, options = {}) {
      // Claim the idle slot synchronously so concurrent releases cannot both
      // await reset and overwrite idlePage (leaking a Chromium tab).
      if (options.destroy || idlePage || reservingIdleSlot) {
        await destroyPage(page)
        return
      }

      reservingIdleSlot = true

      try {
        await resetPageForReuse(page)
        idlePage = page
      } catch {
        await destroyPage(page)
      } finally {
        reservingIdleSlot = false
      }
    },
    async close() {
      const reusable = idlePage
      idlePage = null
      reservingIdleSlot = false
      const current = browser
      browser = null
      browserPromise = null

      if (reusable) {
        await destroyPage(reusable)
      }

      await stopChromium(current)
    },
  }
}
