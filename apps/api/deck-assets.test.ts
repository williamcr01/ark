import express from 'express'
import { describe, expect, it } from 'vitest'

import { handleDeckAssetRequest } from './deck-assets'

function createTestApp() {
  const app = express()

  app.get('/api/deck-assets', async (request, response) => {
    await handleDeckAssetRequest(request, response)
  })

  return app
}

async function requestAsset(url: string) {
  const app = createTestApp()
  const server = app.listen(0)
  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Could not bind test server.')
  }

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/deck-assets?url=${encodeURIComponent(url)}`,
    )
    const contentType = response.headers.get('content-type') ?? ''
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text()

    return { status: response.status, body }
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

function unsetDeckAssetAllowlist() {
  const previous = process.env.ARK_DECK_ASSET_ALLOWLIST
  delete process.env.ARK_DECK_ASSET_ALLOWLIST

  return () => {
    if (previous === undefined) {
      delete process.env.ARK_DECK_ASSET_ALLOWLIST
      return
    }

    process.env.ARK_DECK_ASSET_ALLOWLIST = previous
  }
}

describe('handleDeckAssetRequest', () => {
  it('rejects requests without a url parameter', async () => {
    const app = createTestApp()
    const server = app.listen(0)
    const address = server.address()

    if (!address || typeof address === 'string') {
      throw new Error('Could not bind test server.')
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/deck-assets`)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toMatch(/url query parameter/i)
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

  it('blocks external assets when no allowlist is configured', async () => {
    const restoreDeckAssetAllowlist = unsetDeckAssetAllowlist()

    try {
      const result = await requestAsset('https://example.com/logo.png')

      expect(result.status).toBe(403)
      expect(result.body).toMatchObject({
        error: expect.stringMatching(/blocked/i),
        proxyUrl: '/api/deck-assets?url=https%3A%2F%2Fexample.com%2Flogo.png',
      })
    } finally {
      restoreDeckAssetAllowlist()
    }
  })
})
