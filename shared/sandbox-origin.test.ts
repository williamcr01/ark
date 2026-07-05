import { describe, expect, it } from 'vitest'

import {
  buildSandboxFrameAncestorsCsp,
  buildSandboxRenderUrl,
  buildSandboxResponseCsp,
  isAllowedAppOrigin,
  isAllowedBridgeMessageOrigin,
  isAllowedSandboxOrigin,
  isOpaqueSandboxOrigin,
  OPAQUE_SANDBOX_ORIGIN,
  originsMatch,
  resolveApiOrigin,
  resolveAppOrigin,
  resolveSandboxOrigin,
} from './sandbox-origin.ts'

describe('sandbox-origin', () => {
  it('resolves default local origins', () => {
    expect(resolveAppOrigin({})).toBe('http://localhost:5173')
    expect(resolveSandboxOrigin({})).toBe('http://localhost:5174')
    expect(resolveApiOrigin({ PORT: '9000' })).toBe('http://localhost:9000')
  })

  it('prefers configured origins from env', () => {
    expect(
      resolveSandboxOrigin({
        ARK_SANDBOX_ORIGIN: 'https://preview.example.com/',
        SANDBOX_PORT: '9999',
      }),
    ).toBe('https://preview.example.com')

    expect(
      resolveAppOrigin({
        ARK_APP_ORIGIN: 'https://app.example.com',
        VITE_DEV_PORT: '3000',
      }),
    ).toBe('https://app.example.com')
  })

  it('builds sandbox render URLs with parent origin query params', () => {
    expect(
      buildSandboxRenderUrl('abc123', {
        sandboxOrigin: 'http://localhost:5174',
        appOrigin: 'http://localhost:5173',
      }),
    ).toBe('http://localhost:5174/render/abc123?parent=http%3A%2F%2Flocalhost%3A5173')
  })

  it('treats localhost and 127.0.0.1 as equivalent loopback origins', () => {
    expect(originsMatch('http://localhost:5173', 'http://127.0.0.1:5173')).toBe(true)
    expect(isAllowedAppOrigin('http://127.0.0.1:5173', 'http://localhost:5173')).toBe(true)
  })

  it('accepts opaque sandbox origins for bridge validation', () => {
    expect(isOpaqueSandboxOrigin(OPAQUE_SANDBOX_ORIGIN)).toBe(true)
    expect(isAllowedBridgeMessageOrigin(OPAQUE_SANDBOX_ORIGIN, 'http://localhost:5174')).toBe(true)
    expect(isAllowedSandboxOrigin(OPAQUE_SANDBOX_ORIGIN, 'http://localhost:5174')).toBe(true)
  })

  it('validates allowed sandbox and app origins', () => {
    expect(isAllowedSandboxOrigin('http://localhost:5174', 'http://localhost:5174')).toBe(true)
    expect(isAllowedSandboxOrigin('http://evil.test', 'http://localhost:5174')).toBe(false)
    expect(isAllowedAppOrigin('http://localhost:5173', 'http://localhost:5173')).toBe(true)
    expect(isAllowedAppOrigin('http://localhost:5174', 'http://localhost:5173')).toBe(false)
  })

  it('builds sandbox CSP with frame-ancestors for loopback app origins', () => {
    expect(buildSandboxFrameAncestorsCsp('http://localhost:5173')).toContain(
      'frame-ancestors http://localhost:5173',
    )
    expect(buildSandboxFrameAncestorsCsp('http://localhost:5173')).toContain('127.0.0.1:5173')
    expect(buildSandboxResponseCsp('http://localhost:5173')).toContain("connect-src 'none'")
    expect(buildSandboxResponseCsp('http://localhost:5173')).toContain(
      'http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.js',
    )
    expect(buildSandboxResponseCsp('http://localhost:5173')).toContain(
      'http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.css',
    )
  })
})
