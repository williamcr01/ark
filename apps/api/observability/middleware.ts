import type { NextFunction, Request, Response } from 'express'

import { createLogger, type Logger } from '@ark/telemetry/logger.ts'
import {
  attachRequestIdToJsonBody,
  REQUEST_ID_HEADER,
  resolveRequestId,
} from '@ark/telemetry/request-id.ts'

type RequestContext = {
  requestId: string
  logger: Logger
}

const requestContext = new WeakMap<object, RequestContext>()

export type ObservabilityMiddlewareOptions = {
  service?: string
}

function setRequestContext(request: object, context: RequestContext) {
  requestContext.set(request, context)
}

export function createObservabilityMiddleware(options: ObservabilityMiddlewareOptions = {}) {
  const service = options.service ?? 'ark-api'

  return (request: Request, response: Response, next: NextFunction) => {
    const requestId = resolveRequestId(request.header(REQUEST_ID_HEADER))
    const startedAt = performance.now()
    const logger = createLogger({ service, requestId })

    setRequestContext(request, { requestId, logger })

    response.setHeader(REQUEST_ID_HEADER, requestId)

    const originalJson = response.json.bind(response)

    response.json = ((body: unknown) => {
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        return originalJson(attachRequestIdToJsonBody(body as Record<string, unknown>, requestId))
      }

      return originalJson(body)
    }) as Response['json']

    response.on('finish', () => {
      const durationMs = Math.round(performance.now() - startedAt)
      const level =
        response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info'

      logger.log(level, 'http.request.completed', {
        method: request.method,
        path: request.originalUrl || request.url,
        statusCode: response.statusCode,
        durationMs,
      })
    })

    next()
  }
}

export function getRequestLogger(request: object) {
  const context = requestContext.get(request)

  return (
    context?.logger ??
    createLogger({
      service: 'ark-api',
      requestId: context?.requestId ?? null,
    })
  )
}

export function getRequestId(request: object) {
  return requestContext.get(request)?.requestId ?? null
}
