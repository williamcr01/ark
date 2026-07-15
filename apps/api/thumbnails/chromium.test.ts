import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHROMIUM_STARTUP_TIMEOUT_MS } from './constants.ts'
import {
  buildChromiumLaunchArgs,
  chromiumSandboxAttemptOrder,
  classifyChromiumLaunchFailure,
  isChromiumNoSandboxForced,
  isChromiumSandboxLaunchFailure,
  spawnChromium,
} from './chromium.ts'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('node:fs', () => ({
  existsSync: () => true,
}))

describe('isChromiumNoSandboxForced', () => {
  it('returns false when unset or empty', () => {
    expect(isChromiumNoSandboxForced({})).toBe(false)
    expect(isChromiumNoSandboxForced({ ARK_CHROMIUM_NO_SANDBOX: '' })).toBe(false)
    expect(isChromiumNoSandboxForced({ ARK_CHROMIUM_NO_SANDBOX: '  ' })).toBe(false)
  })

  it('accepts truthy tokens true / 1 / yes / on (case-insensitive)', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'YES', 'on', 'On']) {
      expect(isChromiumNoSandboxForced({ ARK_CHROMIUM_NO_SANDBOX: value })).toBe(true)
    }
  })

  it('rejects other values', () => {
    for (const value of ['false', '0', 'no', 'off', 'enabled', 'sandbox']) {
      expect(isChromiumNoSandboxForced({ ARK_CHROMIUM_NO_SANDBOX: value })).toBe(false)
    }
  })
})

describe('chromiumSandboxAttemptOrder', () => {
  it('forces no-sandbox only when the env override is set', () => {
    expect(chromiumSandboxAttemptOrder({ ARK_CHROMIUM_NO_SANDBOX: 'true' })).toEqual(['no-sandbox'])
    expect(chromiumSandboxAttemptOrder({ ARK_CHROMIUM_NO_SANDBOX: '1' })).toEqual(['no-sandbox'])
  })

  it('prefers sandboxed launch then falls back when not forced', () => {
    expect(chromiumSandboxAttemptOrder({})).toEqual(['sandboxed', 'no-sandbox'])
    expect(chromiumSandboxAttemptOrder({ ARK_CHROMIUM_NO_SANDBOX: 'false' })).toEqual([
      'sandboxed',
      'no-sandbox',
    ])
  })
})

describe('buildChromiumLaunchArgs', () => {
  const debugPort = 9222
  const userDataDir = '/tmp/ark-thumb-chrome-test'

  it('omits --no-sandbox when sandboxed', () => {
    const args = buildChromiumLaunchArgs(debugPort, userDataDir, { noSandbox: false })

    expect(args).toContain('--headless=new')
    expect(args).toContain(`--remote-debugging-port=${debugPort}`)
    expect(args).toContain(`--user-data-dir=${userDataDir}`)
    expect(args).not.toContain('--no-sandbox')
    expect(args.at(-1)).toBe('about:blank')
  })

  it('includes --no-sandbox when requested', () => {
    const args = buildChromiumLaunchArgs(debugPort, userDataDir, { noSandbox: true })

    expect(args).toContain('--no-sandbox')
    expect(args.indexOf('--no-sandbox')).toBeGreaterThan(args.indexOf('--no-first-run'))
    expect(args.indexOf('--no-sandbox')).toBeLessThan(args.indexOf('--disable-popup-blocking'))
  })
})

describe('isChromiumSandboxLaunchFailure', () => {
  it('recognizes common Chromium sandbox stderr messages', () => {
    expect(isChromiumSandboxLaunchFailure('No usable sandbox!')).toBe(true)
    expect(
      isChromiumSandboxLaunchFailure(
        'Running as root without --no-sandbox is not supported. See https://crbug.com/638180.',
      ),
    ).toBe(true)
    expect(isChromiumSandboxLaunchFailure('Failed to move to new namespace: PID namespaces')).toBe(
      true,
    )
  })

  it('rejects unrelated launch failures', () => {
    expect(isChromiumSandboxLaunchFailure('Address already in use')).toBe(false)
    expect(isChromiumSandboxLaunchFailure('profile corruption detected')).toBe(false)
    expect(isChromiumSandboxLaunchFailure('', new Error('Timed out waiting for endpoint'))).toBe(
      false,
    )
  })
})

describe('classifyChromiumLaunchFailure', () => {
  it('labels sandbox vs non-sandbox failures', () => {
    expect(classifyChromiumLaunchFailure('No usable sandbox!')).toBe('sandbox')
    expect(classifyChromiumLaunchFailure('port already allocated')).toBe('non-sandbox')
  })
})

function createMockChild(options: {
  exitImmediately?: boolean
  exitCode?: number | null
  stderrChunks?: string[]
}) {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null
    kill: ReturnType<typeof vi.fn>
    stderr: EventEmitter
    unref: ReturnType<typeof vi.fn>
  }

  child.exitCode = options.exitCode ?? null
  child.kill = vi.fn(() => {
    child.exitCode = child.exitCode ?? 1
    queueMicrotask(() => {
      child.emit('exit', child.exitCode, null)
    })
  })
  child.stderr = new EventEmitter()
  child.unref = vi.fn()

  queueMicrotask(() => {
    for (const chunk of options.stderrChunks ?? []) {
      child.stderr.emit('data', Buffer.from(chunk))
    }

    if (options.exitImmediately) {
      child.exitCode = options.exitCode ?? 1
      child.emit('exit', child.exitCode, null)
    }
  })

  return child
}

describe('spawnChromium startup behavior', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    vi.stubEnv('ARK_CHROMIUM_PATH', '/usr/bin/google-chrome')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('falls back quickly after immediate sandboxed exit and completes within a bounded window', async () => {
    const startedAt = Date.now()
    let attempt = 0

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        const lastArgs = spawnMock.mock.calls.at(-1)?.[1] as string[] | undefined

        if (url.includes('/json/version') && lastArgs?.includes('--no-sandbox')) {
          return new Response(JSON.stringify({ Browser: 'mock' }), { status: 200 })
        }

        return new Response(null, { status: 404 })
      }),
    )

    spawnMock.mockImplementation(() => {
      attempt += 1

      if (attempt === 1) {
        return createMockChild({
          exitImmediately: true,
          stderrChunks: ['No usable sandbox!\n'],
        })
      }

      return createMockChild({})
    })

    const browser = await spawnChromium(9222, '/tmp/ark-thumb-chrome-test')

    expect(Date.now() - startedAt).toBeLessThan(CHROMIUM_STARTUP_TIMEOUT_MS + 2_000)
    expect(attempt).toBe(2)
    expect(browser.sandboxMode).toBe('no-sandbox')
    expect(spawnMock.mock.calls[0]?.[1]).not.toContain('--no-sandbox')
    expect(spawnMock.mock.calls[1]?.[1]).toContain('--no-sandbox')
  })

  it('does not fall back for non-sandbox launch failures', async () => {
    spawnMock.mockImplementation(() =>
      createMockChild({
        exitImmediately: true,
        stderrChunks: ['bind() failed: Address already in use\n'],
      }),
    )

    await expect(spawnChromium(9222, '/tmp/ark-thumb-chrome-test')).rejects.toThrow(
      /Chromium exited early/,
    )
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('aborts in-flight startup when the render signal is cancelled', async () => {
    const controller = new AbortController()
    const child = createMockChild({})

    spawnMock.mockImplementation(() => child)

    const pending = spawnChromium(9222, '/tmp/ark-thumb-chrome-test', {
      signal: controller.signal,
    })

    queueMicrotask(() => {
      controller.abort()
    })

    await expect(pending).rejects.toThrow(/aborted/i)
    expect(child.kill).toHaveBeenCalled()
  })
})
