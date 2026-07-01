import express from 'express'
import { describe, expect, it } from 'vitest'

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
      runtimes: [
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
      ],
    })
  })

  it('serves approved runtime assets with checksum metadata', async () => {
    const response = await requestRuntime('/api/runtimes/reveal.js/5.1.0/reset.css')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/css')
    expect(response.headers.get('x-checksum-sha256')).toMatch(/^[a-f0-9]{64}$/)
    expect(response.body).toContain('margin: 0')
  })

  it('rejects unapproved runtime versions and assets', async () => {
    const badVersion = await requestRuntime('/api/runtimes/reveal.js/4.0.0/reveal.js')
    const badAsset = await requestRuntime('/api/runtimes/reveal.js/5.1.0/missing.js')

    expect(badVersion.status).toBe(404)
    expect(badAsset.status).toBe(404)
  })
})
