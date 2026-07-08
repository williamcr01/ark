import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

type CdpMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
  sessionId?: string
}

type CdpListener = (params: unknown, sessionId: string | null) => void

export type BrowserProcess = {
  process: ChildProcess
  userDataDir: string
  debugPort: number
  stderr: () => string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(
  label: string,
  callback: () => Promise<unknown> | unknown,
  options: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 15_000
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
  private nextId = 1
  private readonly socket: WebSocket

  private constructor(socket: WebSocket) {
    this.socket = socket
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
    this.callbacks.clear()
    this.socket.close()
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
      const timer = setTimeout(() => {
        unsubscribe()
        reject(new Error(`Timed out waiting for CDP event ${method}.`))
      }, timeoutMs)

      const listener: CdpListener = (params, sessionId) => {
        if (!predicate(params, sessionId)) {
          return
        }

        clearTimeout(timer)
        unsubscribe()
        resolve(params)
      }

      const unsubscribe = this.on(method, listener)
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
      '--disable-popup-blocking',
      '--block-new-web-contents',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  // Do not keep the parent Node process alive solely for the shared Chromium pool.
  child.unref()
  child.stdout?.unref()
  child.stderr?.unref()

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

export async function createPage(debugPort: number) {
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

  return {
    cdp: await CdpClient.connect(target.webSocketDebuggerUrl),
    targetId: target.id ?? null,
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
  ensureBrowser: () => Promise<BrowserProcess>
  createPage: () => Promise<{ cdp: CdpClient; targetId: string | null }>
  close: () => Promise<void>
  isAvailable: () => boolean
}

export function createChromiumPool(options: { enabled?: boolean } = {}): ChromiumPool {
  const enabled = options.enabled ?? isThumbnailRendererAvailable()
  let browserPromise: Promise<BrowserProcess> | null = null
  let browser: BrowserProcess | null = null

  const ensureBrowser = async () => {
    if (!enabled) {
      throw new Error('Thumbnail renderer is disabled.')
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
          }
        })

        browser = nextBrowser
        return nextBrowser
      })().catch((error) => {
        browserPromise = null
        browser = null
        throw error
      })
    }

    return browserPromise
  }

  return {
    isAvailable: () => enabled && Boolean(findChromium()),
    ensureBrowser,
    async createPage() {
      const current = await ensureBrowser()
      return createPage(current.debugPort)
    },
    async close() {
      const current = browser
      browser = null
      browserPromise = null
      await stopChromium(current)
    },
  }
}
