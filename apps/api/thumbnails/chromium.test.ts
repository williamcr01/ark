import { describe, expect, it } from 'vitest'

import {
  buildChromiumLaunchArgs,
  chromiumSandboxAttemptOrder,
  isChromiumNoSandboxForced,
} from './chromium.ts'

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
