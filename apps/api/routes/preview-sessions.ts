import express, { Router, type Request, type Response } from 'express'

import { parseRequestBody, createPreviewSessionRequestSchema } from '@ark/contracts'
import {
  buildSandboxRenderUrl,
  resolveAppOrigin,
  resolveSandboxOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'
import { PreviewSessionCapacityError, type PreviewSessionStore } from '../preview-sessions.ts'
import { getRequestLogger } from '../observability/index.ts'
import { logTimedEvent, measureSync } from '../observability/timing.ts'

// Preview sessions carry full deck HTML — align with the global 12mb JSON parser
// used for deck create/update. The in-memory store still enforces its own caps.
export const PREVIEW_SESSION_JSON_LIMIT = '12mb'

export function createPreviewSessionsRouter(deps: {
  previewSessionStore: PreviewSessionStore
}): Router {
  const { previewSessionStore } = deps
  const router = Router()

  router.post(
    '/api/preview-sessions',
    express.json({ limit: PREVIEW_SESSION_JSON_LIMIT }),
    async (request: Request, response: Response) => {
      const parsed = parseRequestBody(createPreviewSessionRequestSchema, request.body)

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error })
        return
      }

      let session
      let durationMs

      try {
        const timed = measureSync(() =>
          previewSessionStore.createSession(parsed.data.html, {
            editorBridge: parsed.data.editorBridge === true,
          }),
        )
        session = timed.result
        durationMs = timed.durationMs
      } catch (error) {
        if (error instanceof PreviewSessionCapacityError) {
          response.status(503).json({ error: error.message })
          return
        }

        throw error
      }

      logTimedEvent(getRequestLogger(request), 'preview.session.created', durationMs, {
        htmlBytes: Buffer.byteLength(parsed.data.html, 'utf8'),
        editorBridge: parsed.data.editorBridge === true,
      })

      response.status(201).json({
        token: session.token,
        handshake: session.handshake,
        expiresAt: session.expiresAt,
        sandboxOrigin: resolveSandboxOrigin(),
        renderUrl: buildSandboxRenderUrl(session.token, {
          sandboxOrigin: resolveSandboxOrigin(),
          appOrigin: resolveAppOrigin(),
        }),
      })
    },
  )

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
        handshake: session.handshake,
        html: session.html,
        editorBridge: session.editorBridge,
        expiresAt: session.expiresAt,
      })
    },
  )

  return router
}
