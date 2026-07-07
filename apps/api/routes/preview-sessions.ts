import { Router, type Request, type Response } from 'express'

import { parseRequestBody, createPreviewSessionRequestSchema } from '@ark/contracts'
import {
  buildSandboxRenderUrl,
  resolveAppOrigin,
  resolveSandboxOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'
import { type PreviewSessionStore } from '../preview-sessions.ts'
import { getRequestLogger } from '../observability/index.ts'
import { logTimedEvent, measureSync } from '../observability/timing.ts'

export function createPreviewSessionsRouter(deps: {
  previewSessionStore: PreviewSessionStore
}): Router {
  const { previewSessionStore } = deps
  const router = Router()

  router.post('/api/preview-sessions', async (request: Request, response: Response) => {
    const parsed = parseRequestBody(createPreviewSessionRequestSchema, request.body)

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    const { result: session, durationMs } = measureSync(() =>
      previewSessionStore.createSession(parsed.data.html, {
        editorBridge: parsed.data.editorBridge === true,
      }),
    )

    logTimedEvent(getRequestLogger(request), 'preview.session.created', durationMs, {
      htmlBytes: Buffer.byteLength(parsed.data.html, 'utf8'),
      editorBridge: parsed.data.editorBridge === true,
    })

    response.status(201).json({
      token: session.token,
      expiresAt: session.expiresAt,
      sandboxOrigin: resolveSandboxOrigin(),
      renderUrl: buildSandboxRenderUrl(session.token, {
        sandboxOrigin: resolveSandboxOrigin(),
        appOrigin: resolveAppOrigin(),
      }),
    })
  })

  router.get(
    '/api/preview-sessions/:token',
    (request: Request<{ token: string }>, response: Response) => {
      const token = request.params.token?.trim()

      if (!token) {
        response.status(400).json({ error: 'Preview token is required.' })
        return
      }

      const session = previewSessionStore.getSession(token)

      if (!session) {
        response.status(404).json({ error: 'Preview session not found or expired.' })
        return
      }

      response.json({
        token: session.token,
        html: session.html,
        editorBridge: session.editorBridge,
        expiresAt: session.expiresAt,
      })
    },
  )

  return router
}
