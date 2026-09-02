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
    expect(isAllowedAppOrigin('http://evil.test', 'http://localhost:5173')).toBe(false)
    expect(isAllowedAppOrigin('https://app.example.com', 'https://app.example.com')).toBe(true)
    expect(isAllowedAppOrigin('https://evil.example.com', 'https://app.example.com')).toBe(false)
  })

  it('allows alternate loopback Vite ports when the configured app origin is loopback', () => {
    expect(isAllowedAppOrigin('http://localhost:5175', 'http://localhost:5173')).toBe(true)
    expect(isAllowedAppOrigin('http://127.0.0.1:5175', 'http://localhost:5173')).toBe(true)
    expect(isAllowedAppOrigin('http://localhost:5175', 'https://app.example.com')).toBe(false)
  })

  it('builds sandbox CSP with frame-ancestors for loopback app origins', () => {
    expect(buildSandboxFrameAncestorsCsp('http://localhost:5173')).toContain(
      'frame-ancestors http://localhost:5173',
    )
    expect(buildSandboxFrameAncestorsCsp('http://localhost:5173')).toContain('127.0.0.1:5173')
    expect(buildSandboxResponseCsp('http://localhost:5173')).toContain("connect-src 'none'")
    expect(buildSandboxResponseCsp('http://localhost:5173')).toContain(
      'img-src data: blob: http://localhost:5173',
    )
    expect(buildSandboxResponseCsp('http://localhost:5173')).toContain(
      'http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.js',
    )
    expect(buildSandboxResponseCsp('http://localhost:5173')).toContain(
      'http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.css',
    )
    expect(buildSandboxResponseCsp('http://localhost:5173')).toContain(
      'http://localhost:5173/api/runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/source-sans-pro.css',
    )
    expect(buildSandboxResponseCsp('http://localhost:5173')).toContain(
      'http://localhost:5173/api/runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/source-sans-pro-regular.woff',
    )
    expect(buildSandboxResponseCsp('http://localhost:5173')).toMatch(
      /font-src[^;]*http:\/\/localhost:5173\/api\/runtimes\/deck-fonts\/1\.0\.0\/carlito\/carlito-latin-400-normal\.woff2/,
    )
    expect(buildSandboxResponseCsp('http://localhost:5173')).toContain(
      'http://localhost:5173/api/runtimes/deck-fonts/1.0.0/liberation-sans/LiberationSans-Regular.woff2',
    )
  })

  it('uses a nonce instead of unsafe-inline for static/reveal response CSP', () => {
    const staticCsp = buildSandboxResponseCsp('http://localhost:5173', {
      runtimeMode: 'static',
      nonce: 'abc',
    })
    const revealCsp = buildSandboxResponseCsp('http://localhost:5173', {
      runtimeMode: 'reveal',
      nonce: 'abc',
    })
    const customCsp = buildSandboxResponseCsp('http://localhost:5173', {
      runtimeMode: 'custom-js',
      nonce: 'abc',
    })

    expect(staticCsp).toContain("'nonce-abc'")
    expect(staticCsp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(revealCsp).toContain("'nonce-abc'")
    expect(revealCsp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(customCsp).toContain("'unsafe-inline'")
    expect(customCsp).not.toContain("'nonce-")
  })
})
