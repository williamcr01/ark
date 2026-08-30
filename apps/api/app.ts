import express from 'express'

import { registerRoutes } from './routes/index.ts'
import { createApiServices, type CreateAppOptions } from './services.ts'

export type { CreateAppOptions }

/**
 * The local API is a thin composition root: build the service graph, mount the routers, and
 * expose the few handles the Electron main process needs at shutdown.
 */
export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const services = createApiServices(options)

  registerRoutes(app, services, { onMcpActivity: options.onMcpActivity })

  // Exposed for the Electron main process shutdown hook.
  app.locals.thumbnailService = services.thumbnailService
  app.locals.thumbnailRenderSecret = services.thumbnailRenderSecret
  app.locals.workspaceStore = services.workspaceStore
  app.locals.mcpServiceState = services.mcpServiceState
  app.locals.mcpInteractionStore = services.mcpInteractionStore

  return app
}
