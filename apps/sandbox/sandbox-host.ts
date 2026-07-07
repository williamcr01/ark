import express, { type Request, type Response } from 'express'

import {
  buildSandboxResponseCsp,
  isAllowedAppOrigin,
  normalizeOrigin,
  resolveApiOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'
import { renderPreviewHtml } from './render-preview-html.ts'
import { type PreviewSessionStore } from '@ark/api/preview-sessions.ts'

type CreateSandboxHostOptions = {
  previewSessionStore: PreviewSessionStore
  apiOrigin?: string
}

function applySandboxSecurityHeaders(response: Response, appOrigin: string) {
  response.setHeader('Content-Security-Policy', buildSandboxResponseCsp(appOrigin))
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
            editorBridge?: boolean
          }

          if (payload.html?.trim()) {
            session = {
              token,
              html: payload.html,
              editorBridge: payload.editorBridge === true,
              createdAt: Date.now(),
              expiresAt: Date.now() + 60_000,
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

    const previewHtml = renderPreviewHtml(session.html, {
      parentOrigin,
      editorBridge: session.editorBridge,
    })

    applySandboxSecurityHeaders(response, parentOrigin)
    response.type('html').send(previewHtml)
  })

  return app
}
