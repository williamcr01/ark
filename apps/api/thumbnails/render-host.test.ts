import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'

import { createPreviewSessionStore } from '../preview-sessions.ts'
import {
  createThumbnailRenderAccessGuard,
  createThumbnailRenderRouter,
  createThumbnailRenderSecret,
  isLoopbackAddress,
  renderThumbnailPreviewDocument,
  THUMBNAIL_RENDER_SECRET_HEADER,
} from './render-host.ts'

function createFakeGuardArgs(
  remoteAddress: string | undefined,
  headers: Record<string, string> = {},
) {
  const response = {
    statusCode: 200,
    body: '',
    status(code: number) {
      this.statusCode = code
      return this
    },
    send(payload: string) {
      this.body = payload
      return this
    },
  }
  const next = vi.fn()
  const request = {
    socket: { remoteAddress },
    get(name: string) {
      return headers[name.toLowerCase()] ?? headers[name]
    },
  }

  return {
    request: request as unknown as Request,
    response: response as unknown as Response,
    rawResponse: response,
    next: next as unknown as NextFunction,
    nextMock: next,
  }
}

describe('isLoopbackAddress', () => {
  it('accepts loopback addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('127.1.2.3')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
  })

  it('rejects non-loopback and missing addresses', () => {
    expect(isLoopbackAddress('10.0.0.5')).toBe(false)
    expect(isLoopbackAddress('192.168.1.20')).toBe(false)
    expect(isLoopbackAddress('::ffff:10.0.0.5')).toBe(false)
    expect(isLoopbackAddress('2001:db8::1')).toBe(false)
    expect(isLoopbackAddress('')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
    expect(isLoopbackAddress(null)).toBe(false)
  })
})

describe('createThumbnailRenderAccessGuard', () => {
  const secret = createThumbnailRenderSecret()
  const guard = createThumbnailRenderAccessGuard(secret)

  it('passes loopback requests that present the render secret', () => {
    const { request, response, next, nextMock } = createFakeGuardArgs('127.0.0.1', {
      [THUMBNAIL_RENDER_SECRET_HEADER]: secret,
    })

    guard(request, response, next)

    expect(nextMock).toHaveBeenCalledOnce()
  })

  it('rejects loopback requests missing the render secret (Vite proxy bypass)', () => {
    const { request, response, rawResponse, next, nextMock } = createFakeGuardArgs('127.0.0.1')

    guard(request, response, next)

    expect(nextMock).not.toHaveBeenCalled()
    expect(rawResponse.statusCode).toBe(403)
    expect(rawResponse.body).toContain('renderer secret')
  })

  it('rejects loopback requests with the wrong render secret', () => {
    const { request, response, rawResponse, next, nextMock } = createFakeGuardArgs('127.0.0.1', {
      [THUMBNAIL_RENDER_SECRET_HEADER]: 'not-the-secret',
    })

    guard(request, response, next)

    expect(nextMock).not.toHaveBeenCalled()
    expect(rawResponse.statusCode).toBe(403)
  })

  it('rejects remote requests even with the correct secret', () => {
    const { request, response, rawResponse, next, nextMock } = createFakeGuardArgs('10.0.0.5', {
      [THUMBNAIL_RENDER_SECRET_HEADER]: secret,
    })

    guard(request, response, next)

    expect(nextMock).not.toHaveBeenCalled()
    expect(rawResponse.statusCode).toBe(403)
  })
})

describe('renderThumbnailPreviewDocument', () => {
  it('injects thumbnail-only motion disabling and settle acknowledgement hooks', () => {
    const preview = renderThumbnailPreviewDocument(
      '<!DOCTYPE html><html><body><section class="slide"><h1>One</h1></section></body></html>',
      { parentOrigin: 'http://127.0.0.1:8787' },
    )

    expect(preview.html).toContain('data-ark-thumbnail-disable-motion')
    expect(preview.html).not.toContain('animation: none !important')
    expect(preview.html).not.toContain('transition: none !important')
    expect(preview.html).toContain('animation-duration: 0s !important')
    expect(preview.html).toContain('animation-delay: 0s !important')
    expect(preview.html).toContain('transition-duration: 0s !important')
    expect(preview.html).toContain('transition-delay: 0s !important')
    expect(preview.html).toContain('.reveal .slides section.present')
    expect(preview.html).toContain('.reveal .fragment')
    expect(preview.html).toContain('data-ark-thumbnail-settle')
    expect(preview.html).toContain('ark:thumbnail-settle')
    expect(preview.html).toContain('ark:thumbnail-settled')
    expect(preview.html).toContain('waitForImages')
    expect(preview.html).toContain('document.images')
    expect(preview.html).toContain('img.decode')
    expect(preview.html).toContain("classList.add('visible')")
    expect(preview.html).toContain('document.getAnimations')
    expect(preview.html).toContain('animations[i].finish()')
    expect(preview.html).toContain('document.fonts.ready')
    expect(preview.html).toContain('requestAnimationFrame')
    expect(preview.html).toContain('waitForPaintedFrame')
    expect(preview.html).toContain('window.__arkThumbGoto')
    expect(preview.html).toContain('window.__arkThumbRequestSettle')
    expect(preview.html).toContain('window.__arkThumbReady')

    const settleScript = preview.html.match(/<script data-ark-thumbnail-settle="" nonce="([^"]+)">/)
    expect(settleScript?.[1]).toBeTruthy()
  })
})

describe('thumbnail render routes over loopback', () => {
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
      server = null
    }
  })

  it('serves preview sessions to authenticated loopback clients and 404s unknown tokens', async () => {
    const previewSessionStore = createPreviewSessionStore()
    const renderSecret = createThumbnailRenderSecret()
    const session = previewSessionStore.createSession(
      '<!DOCTYPE html><html><body><section class="slide"><h1>One</h1></section></body></html>',
    )
    const app = express()
    app.use(createThumbnailRenderRouter({ previewSessionStore, renderSecret }))

    server = createServer(app)
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`
    const authHeaders = { [THUMBNAIL_RENDER_SECRET_HEADER]: renderSecret }

    const hostResponse = await fetch(`${baseUrl}/api/thumbnail-render/${session.token}/host`, {
      headers: authHeaders,
    })
    expect(hostResponse.status).toBe(200)
    expect(await hostResponse.text()).toContain('ark-thumb-frame')

    const deckResponse = await fetch(`${baseUrl}/api/thumbnail-render/${session.token}`, {
      headers: authHeaders,
    })
    expect(deckResponse.status).toBe(200)
    expect(deckResponse.headers.get('content-security-policy')).toContain("connect-src 'none'")
    expect(deckResponse.headers.get('content-security-policy')).toContain("form-action 'none'")
    expect(deckResponse.headers.get('content-security-policy')).toContain("object-src 'none'")
    expect(deckResponse.headers.get('cross-origin-opener-policy')).toBe('same-origin')

    const hostHtml = await (
      await fetch(`${baseUrl}/api/thumbnail-render/${session.token}/host`, {
        headers: authHeaders,
      })
    ).text()
    expect(hostHtml).toContain('sandbox="allow-scripts"')
    expect(hostHtml).not.toContain('allow-popups')
    expect(hostHtml).not.toContain('allow-top-navigation')
    expect(hostResponse.headers.get('content-security-policy')).toContain("connect-src 'none'")
    expect(hostResponse.headers.get('content-security-policy')).toContain("form-action 'none'")
    expect(hostResponse.headers.get('content-security-policy')).toContain("object-src 'none'")

    const fullJsSession = previewSessionStore.createSession(
      `<!DOCTYPE html><html lang="en" data-ark-preview="full-js"><body><section class="slide"><h1>JS</h1></section><script>fetch('https://evil.example')</script></body></html>`,
    )
    const fullJsResponse = await fetch(`${baseUrl}/api/thumbnail-render/${fullJsSession.token}`, {
      headers: authHeaders,
    })
    expect(fullJsResponse.status).toBe(200)
    expect(fullJsResponse.headers.get('content-security-policy')).toContain("connect-src 'none'")
    expect(fullJsResponse.headers.get('content-security-policy')).toContain("form-action 'none'")
    expect(fullJsResponse.headers.get('content-security-policy')).toContain("object-src 'none'")

    const missingResponse = await fetch(`${baseUrl}/api/thumbnail-render/does-not-exist`, {
      headers: authHeaders,
    })
    expect(missingResponse.status).toBe(404)

    // Loopback without the secret must be rejected (Vite proxy would look like this).
    const unauthResponse = await fetch(`${baseUrl}/api/thumbnail-render/${session.token}/host`)
    expect(unauthResponse.status).toBe(403)
  })
})
