import { createHash } from 'node:crypto'

import express from 'express'
import { describe, expect, it } from 'vitest'

import { buildSandboxResponseCsp } from '@ark/runtime-registry/sandbox-origin.ts'

import { handleRuntimeRoutes } from './deck-runtimes'

function createTestApp() {
  const app = express()
  app.use(handleRuntimeRoutes)
  return app
}

async function requestRuntime(pathname: string) {
  const app = createTestApp()
  const server = app.listen(0)
  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Could not bind test server.')
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`)
    const contentType = response.headers.get('content-type') ?? ''
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text()

    return {
      status: response.status,
      body,
      headers: response.headers,
    }
  } finally {
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
}

describe('handleRuntimeRoutes', () => {
  it('lists approved runtime metadata', async () => {
    const response = await requestRuntime('/api/runtimes')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      schemaVersion: 1,
      runtimes: expect.arrayContaining([
        expect.objectContaining({
          id: 'reveal.js',
          version: '5.1.0',
          assets: expect.arrayContaining([
            expect.objectContaining({
              path: 'reveal.js',
              url: '/api/runtimes/reveal.js/5.1.0/reveal.js',
            }),
          ]),
        }),
        expect.objectContaining({
          id: 'chart.js',
          version: '4.5.1',
          runtimeMode: 'custom-js',
          previewMode: 'full-js',
          allowsDeckScripts: true,
          assets: expect.arrayContaining([
            expect.objectContaining({
              path: 'chart.umd.min.js',
              url: '/api/runtimes/chart.js/4.5.1/chart.umd.min.js',
            }),
          ]),
        }),
        expect.objectContaining({
          id: 'deck-fonts',
          version: '1.0.0',
          runtimeMode: 'static',
          previewMode: 'css-only',
          allowsDeckScripts: false,
          assets: expect.arrayContaining([
            expect.objectContaining({
              path: 'carlito/carlito-latin-400-normal.woff2',
              kind: 'font',
              url: '/api/runtimes/deck-fonts/1.0.0/carlito/carlito-latin-400-normal.woff2',
            }),
          ]),
        }),
      ]),
    })
    expect((response.body as { runtimes: unknown[] }).runtimes).toHaveLength(3)
  })

  it('serves approved chart.js runtime assets with checksum metadata', async () => {
    const response = await requestRuntime('/api/runtimes/chart.js/4.5.1/chart.umd.min.js')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('javascript')
    expect(response.headers.get('x-checksum-sha256')).toMatch(/^[a-f0-9]{64}$/)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(String(response.body)).toContain('Chart')
  })

  it('serves approved runtime assets with checksum metadata', async () => {
    const response = await requestRuntime('/api/runtimes/reveal.js/5.1.0/reset.css')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/css')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-checksum-sha256')).toMatch(/^[a-f0-9]{64}$/)
    expect(response.body).toContain('margin: 0')
  })

  it('serves nested runtime assets when the asset path is encoded as one segment', async () => {
    const response = await requestRuntime('/api/runtimes/reveal.js/5.1.0/theme%2Fwhite.css')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/css')
    expect(response.headers.get('x-checksum-sha256')).toMatch(/^[a-f0-9]{64}$/)
    expect(response.body).toContain('White theme')
  })

  it('serves approved runtime font assets with font content types', async () => {
    const response = await requestRuntime(
      '/api/runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/source-sans-pro-regular.woff',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('font/woff')
    expect(response.headers.get('x-checksum-sha256')).toMatch(/^[a-f0-9]{64}$/)
  })

  it('serves vendored metric-clone fonts allowed by sandbox font-src', async () => {
    const pathname = '/api/runtimes/deck-fonts/1.0.0/carlito/carlito-latin-400-normal.woff2'
    const app = createTestApp()
    const server = app.listen(0)
    const address = server.address()

    if (!address || typeof address === 'string') {
      throw new Error('Could not bind test server.')
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      const digest = createHash('sha256').update(bytes).digest('hex')
      const csp = buildSandboxResponseCsp('http://127.0.0.1')

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('font/woff2')
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
      expect(response.headers.get('x-checksum-sha256')).toBe(digest)
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('wOF2')
      expect(csp).toMatch(
        /font-src[^;]*http:\/\/127\.0\.0\.1\/api\/runtimes\/deck-fonts\/1\.0\.0\/carlito\/carlito-latin-400-normal\.woff2/,
      )
    } finally {
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
  })

  it('rejects unapproved runtime versions and assets', async () => {
    const badVersion = await requestRuntime('/api/runtimes/reveal.js/4.0.0/reveal.js')
    const badAsset = await requestRuntime('/api/runtimes/reveal.js/5.1.0/missing.js')
    const malformedAsset = await requestRuntime('/api/runtimes/reveal.js/5.1.0/theme%2')

    expect(badVersion.status).toBe(404)
    expect(badAsset.status).toBe(404)
    expect(malformedAsset.status).toBe(400)
  })
})
