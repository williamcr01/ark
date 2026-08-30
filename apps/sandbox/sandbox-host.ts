import express, { type Request, type Response } from 'express'

import {
  buildSandboxResponseCsp,
  isAllowedAppOrigin,
  normalizeOrigin,
  resolveApiOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'
import { renderCachedPreviewDocument } from './render-preview-html.ts'
import { defaultPreviewHtmlCache, type PreviewHtmlCache } from './preview-html-cache.ts'
import { type PreviewSessionStore } from '@ark/storage/stores/preview-sessions.ts'

type CreateSandboxHostOptions = {
  previewSessionStore: PreviewSessionStore
  apiOrigin?: string
  previewHtmlCache?: PreviewHtmlCache
}

function applySandboxSecurityHeaders(
  response: Response,
  appOrigin: string,
  options: { runtimeMode?: 'static' | 'reveal' | 'custom-js'; nonce?: string | null } = {},
) {
  response.setHeader(
    'Content-Security-Policy',
    buildSandboxResponseCsp(appOrigin, {
      runtimeMode: options.runtimeMode,
      nonce: options.nonce,
    }),
  )
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Cache-Control', 'no-store')
  response.removeHeader('Set-Cookie')
}

export function createSandboxHost(options: CreateSandboxHostOptions) {
  const app = express()
  const apiOrigin = options.apiOrigin ?? resolveApiOrigin()
  const previewHtmlCache = options.previewHtmlCache ?? defaultPreviewHtmlCache

  app.disable('x-powered-by')

  app.get('/health', (_request, response) => {
    response.json({ ok: true, service: 'sandbox-host', apiOrigin })
  })

  app.get('/render/:token', async (request: Request<{ token: string }>, response: Response) => {
    const token = request.params.token?.trim()
    const parentOrigin = normalizeOrigin(
      typeof request.query.parent === 'string' ? request.query.parent : '',
    )

    if (!token) {
      response.status(400).send('Preview token is required.')
      return
    }

    if (!parentOrigin || !isAllowedAppOrigin(parentOrigin)) {
      response.status(400).send('A valid parent app origin is required.')
      return
    }

    let session = options.previewSessionStore.getSession(token)

    if (!session) {
      try {
        const sessionResponse = await fetch(
          `${apiOrigin}/api/preview-sessions/${encodeURIComponent(token)}`,
        )

        if (sessionResponse.ok) {
          const payload = (await sessionResponse.json()) as {
            html?: string
            handshake?: string
            editorBridge?: boolean
          }

          if (payload.html?.trim()) {
            const now = Date.now()
            session = {
              token,
              handshake: typeof payload.handshake === 'string' ? payload.handshake : token,
              html: payload.html,
              editorBridge: payload.editorBridge === true,
              createdAt: now,
              lastAccessedAt: now,
              expiresAt: now + 60_000,
            }
          }
        }
      } catch {
        // Fall through to 404 below when the local store and API lookup both miss.
      }
    }

    if (!session) {
      response.status(404).send('Preview session not found or expired.')
      return
    }

    const preview = renderCachedPreviewDocument(
      session.html,
      {
        parentOrigin,
        editorBridge: session.editorBridge,
        handshake: session.handshake,
      },
      previewHtmlCache,
    )

    applySandboxSecurityHeaders(response, parentOrigin, {
      runtimeMode: preview.runtimeMode,
      nonce: preview.nonce,
    })
    response.type('html').send(preview.html)
  })

  return app
}
