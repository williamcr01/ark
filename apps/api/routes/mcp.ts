import { Router, type Request } from 'express'

import { mcpToolRequestSchema, type McpActivityEvent, type McpToolResponse } from '@ark/contracts'
import { isMcpToolName } from '@ark/mcp/tool-catalog.ts'
import type { McpServiceState } from '@ark/mcp/service.ts'
import { McpRunnerError } from '@ark/mcp/runner.ts'
import { getRequestLogger } from '../observability/index.ts'

function bearerToken(request: Request) {
  const header = request.get('authorization')
  return header?.startsWith('Bearer ') ? header.slice(7) : ''
}

export function createMcpRouter(options: {
  state: McpServiceState
  runTool: (
    name: string,
    args: Record<string, unknown>,
    clientName: string | null,
    clientSessionId?: string,
  ) => Promise<McpToolResponse>
  onActivity?: (activity: McpActivityEvent) => void
}) {
  const router = Router()
  const connectedClients = new Set<string>()

  router.post(
    '/api/internal/mcp/tools/:name',
    async (request: Request<{ name: string }>, response) => {
      if (request.hostname !== '127.0.0.1' || request.get('origin')) {
        response
          .status(403)
          .json({ error: 'MCP requests must come from Ark loopback.', code: 'MCP_FORBIDDEN' })
        return
      }
      if (!options.state.authenticate(bearerToken(request))) {
        response
          .status(401)
          .json({ error: 'MCP access is disabled or unauthorized.', code: 'MCP_DISABLED' })
        return
      }
      const name = request.params.name
      if (!isMcpToolName(name)) {
        response.status(404).json({ error: 'Unknown MCP tool.', code: 'UNKNOWN_TOOL' })
        return
      }
      const parsed = mcpToolRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        response.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid MCP request.',
          code: 'INVALID_TOOL_ARGUMENTS',
        })
        return
      }

      const clientName = parsed.data.client?.name ?? null
      const logger = getRequestLogger(request)
      const startedAt = performance.now()
      if (clientName && !connectedClients.has(clientName)) {
        connectedClients.add(clientName)
        logger.info('mcp.client.connected', { clientName })
      }
      logger.info('mcp.tool.started', { toolName: name, clientName })

      try {
        const result = await options.runTool(
          name,
          parsed.data.arguments,
          clientName,
          parsed.data.client?.sessionId,
        )
        const activity = {
          clientName,
          toolName: name,
          summary: (result.activitySummary ?? result.text).slice(0, 500),
          occurredAt: new Date().toISOString(),
          failed: Boolean(result.isError),
        }
        options.onActivity?.(activity)
        logger.log(
          result.isError ? 'warn' : 'info',
          result.isError ? 'mcp.tool.failed' : 'mcp.tool.succeeded',
          {
            toolName: name,
            clientName,
            durationMs: Math.round(performance.now() - startedAt),
          },
        )
        response.json(result)
      } catch (error) {
        if (error instanceof McpRunnerError) {
          const event = error.code === 'DOCUMENT_CONFLICT' ? 'mcp.tool.conflict' : 'mcp.tool.failed'
          options.onActivity?.({
            clientName,
            toolName: name,
            summary: error.message,
            occurredAt: new Date().toISOString(),
            failed: true,
          })
          logger.warn(event, {
            toolName: name,
            clientName,
            errorCategory: error.code,
            durationMs: Math.round(performance.now() - startedAt),
          })
          response
            .status(error.status)
            .json({ error: error.message, code: error.code, ...error.details })
          return
        }
        options.onActivity?.({
          clientName,
          toolName: name,
          summary: 'Ark could not run the MCP tool.',
          occurredAt: new Date().toISOString(),
          failed: true,
        })
        logger.error('mcp.tool.failed', {
          toolName: name,
          clientName,
          errorCategory: 'MCP_TOOL_FAILED',
          durationMs: Math.round(performance.now() - startedAt),
        })
        response
          .status(500)
          .json({ error: 'Ark could not run the MCP tool.', code: 'MCP_TOOL_FAILED' })
      }
    },
  )

  return router
}
