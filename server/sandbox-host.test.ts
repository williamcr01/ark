import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { buildSandboxRenderUrl } from '../shared/sandbox-origin.ts'
import { createApp } from './app.ts'
import { createSandboxHost } from './sandbox-host.ts'
import { createPreviewSessionStore } from './preview-sessions.ts'

const plainCssDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Demo</title></head>
<body>
  <section class="slide"><h1>One</h1></section>
  <section class="slide"><h1>Two</h1></section>
  <section class="slide"><h1>Three</h1></section>
</body>
</html>`

describe('sandbox preview host', () => {
  let apiServer: Server | null = null
  let sandboxServer: Server | null = null

  afterEach(async () => {
    for (const server of [sandboxServer, apiServer]) {
      if (!server) {
        continue
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }

    apiServer = null
    sandboxServer = null
  })

  it('serves rendered deck HTML from a separate sandbox origin with security headers', async () => {
    const previewSessionStore = createPreviewSessionStore()
    const app = createApp({ previewSessionStore })

    apiServer = app.listen(0)
    const apiPort = (apiServer.address() as AddressInfo).port
    const apiOrigin = `http://127.0.0.1:${apiPort}`
    const appOrigin = 'http://localhost:5173'

    const sessionResponse = await fetch(`${apiOrigin}/api/preview-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: plainCssDeck }),
    })

    expect(sessionResponse.status).toBe(201)

    const sessionPayload = (await sessionResponse.json()) as { token: string }
    const sandboxApp = createSandboxHost({ previewSessionStore, apiOrigin })

    sandboxServer = sandboxApp.listen(0)
    const sandboxPort = (sandboxServer.address() as AddressInfo).port
    const sandboxOrigin = `http://127.0.0.1:${sandboxPort}`

    const renderUrl = buildSandboxRenderUrl(sessionPayload.token, {
      sandboxOrigin,
      appOrigin,
    })

    const renderResponse = await fetch(renderUrl)

    expect(renderResponse.status).toBe(200)
    expect(renderResponse.headers.get('content-security-policy')).toContain("connect-src 'none'")
    expect(renderResponse.headers.get('content-security-policy')).toContain(
      'frame-ancestors http://localhost:5173',
    )
    expect(renderResponse.headers.get('content-security-policy')).toContain('127.0.0.1:5173')
    expect(renderResponse.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(renderResponse.headers.get('cross-origin-resource-policy')).toBe('cross-origin')

    const html = await renderResponse.text()

    expect(html).toContain('data-ark-preview-nav')
    expect(html).toContain('Content-Security-Policy')
    expect(html).not.toContain('<script>window.top.location')
  })

  it('rejects render requests with an invalid parent origin', async () => {
    const previewSessionStore = createPreviewSessionStore()
    const session = previewSessionStore.createSession(plainCssDeck)
    const sandboxApp = createSandboxHost({
      previewSessionStore,
      apiOrigin: 'http://127.0.0.1:1',
    })

    sandboxServer = sandboxApp.listen(0)
    const sandboxPort = (sandboxServer.address() as AddressInfo).port

    const response = await fetch(
      `http://127.0.0.1:${sandboxPort}/render/${session.token}?parent=http://evil.test`,
    )

    expect(response.status).toBe(400)
  })
})
