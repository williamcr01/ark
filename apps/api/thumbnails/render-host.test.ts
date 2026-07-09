import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'

import { createPreviewSessionStore } from '../preview-sessions.ts'
import {
  createThumbnailRenderRouter,
  isLoopbackAddress,
  thumbnailRenderLoopbackGuard,
} from './render-host.ts'

function createFakeGuardArgs(remoteAddress: string | undefined) {
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
  const request = { socket: { remoteAddress } }

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

describe('thumbnailRenderLoopbackGuard', () => {
  it('passes loopback requests through', () => {
    const { request, response, next, nextMock } = createFakeGuardArgs('127.0.0.1')

    thumbnailRenderLoopbackGuard(request, response, next)

    expect(nextMock).toHaveBeenCalledOnce()
  })

  it('rejects remote requests with 403', () => {
    const { request, response, rawResponse, next, nextMock } = createFakeGuardArgs('10.0.0.5')

    thumbnailRenderLoopbackGuard(request, response, next)

    expect(nextMock).not.toHaveBeenCalled()
    expect(rawResponse.statusCode).toBe(403)
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

  it('serves preview sessions to loopback clients and 404s unknown tokens', async () => {
    const previewSessionStore = createPreviewSessionStore()
    const session = previewSessionStore.createSession(
      '<!DOCTYPE html><html><body><section class="slide"><h1>One</h1></section></body></html>',
    )
    const app = express()
    app.use(createThumbnailRenderRouter({ previewSessionStore }))

    server = createServer(app)
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`

    const hostResponse = await fetch(`${baseUrl}/api/thumbnail-render/${session.token}/host`)
    expect(hostResponse.status).toBe(200)
    expect(await hostResponse.text()).toContain('ark-thumb-frame')

    const deckResponse = await fetch(`${baseUrl}/api/thumbnail-render/${session.token}`)
    expect(deckResponse.status).toBe(200)
    expect(deckResponse.headers.get('content-security-policy')).toContain("connect-src 'none'")

    const missingResponse = await fetch(`${baseUrl}/api/thumbnail-render/does-not-exist`)
    expect(missingResponse.status).toBe(404)
  })
})
