import { randomUUID } from 'node:crypto'

import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { mcpToolResponseSchema } from '@ark/contracts'
import {
  MCP_SERVER_INSTRUCTIONS,
  MCP_TOOL_CATALOG,
  type McpToolName,
} from '@ark/mcp/tool-catalog.ts'
import { readMcpDiscovery } from '@ark/mcp/discovery.ts'

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function errorResult(code: string, message: string, details: Record<string, unknown> = {}) {
  const structuredContent = { error: message, code, ...details }
  return {
    content: [{ type: 'text' as const, text: message }],
    structuredContent,
    isError: true,
  }
}

async function forwardToolCall(
  discoveryPath: string,
  name: McpToolName,
  args: Record<string, unknown>,
  client: { name: string; version?: string; sessionId: string } | null,
) {
  let discovery
  try {
    discovery = await readMcpDiscovery(discoveryPath)
  } catch {
    return errorResult('MCP_DISABLED', 'Start MCP in Ark, then retry this tool call.')
  }
  if (!processIsAlive(discovery.pid)) {
    return errorResult('ARK_NOT_RUNNING', 'Ark is not running. Open Ark, start MCP, and retry.')
  }

  try {
    const response = await fetch(
      `${discovery.apiOrigin}/api/internal/mcp/tools/${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${discovery.sessionCapability}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ arguments: args, client }),
      },
    )
    const body: unknown = await response.json()
    if (!response.ok) {
      const error = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
      return errorResult(
        typeof error.code === 'string' ? error.code : 'MCP_REQUEST_FAILED',
        typeof error.error === 'string' ? error.error : 'Ark could not run the tool.',
        error,
      )
    }
    const result = mcpToolResponseSchema.parse(body)
    return {
      content: [{ type: 'text' as const, text: result.text }],
      structuredContent: result.structuredContent,
      ...(result.isError ? { isError: true } : {}),
    }
  } catch {
    return errorResult(
      'ARK_UNAVAILABLE',
      'Ark is unavailable. Open Ark, start MCP, and retry this tool call.',
    )
  }
}

export function runMcpBridge(discoveryPath: string) {
  let activeServer: McpServer | null = null
  const sessionId = randomUUID()
  const handle = serveStdio(
    () => {
      const server = new McpServer(
        { name: 'ark', version: '0.0.0' },
        { instructions: MCP_SERVER_INSTRUCTIONS },
      )
      activeServer = server

      for (const [rawName, definition] of Object.entries(MCP_TOOL_CATALOG)) {
        const name = rawName as McpToolName
        const sideEffecting = 'sideEffecting' in definition && definition.sideEffecting === true
        server.registerTool(
          name,
          {
            description: definition.description,
            inputSchema: definition.inputSchema,
            annotations: {
              readOnlyHint: !definition.mutating && !sideEffecting,
              destructiveHint: name === 'write_deck',
              idempotentHint: !definition.mutating && !sideEffecting,
            },
          },
          async (args: unknown) => {
            const clientVersion = server.server.getClientVersion()
            return forwardToolCall(
              discoveryPath,
              name,
              args as Record<string, unknown>,
              clientVersion
                ? {
                    name: clientVersion.name,
                    sessionId,
                    ...(clientVersion.version ? { version: clientVersion.version } : {}),
                  }
                : null,
            )
          },
        )
      }
      return server
    },
    { onerror: () => undefined },
  )

  const close = () => void handle.close().finally(() => process.exit(0))
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  process.stdin.once('end', close)
  return { close: () => activeServer?.close() ?? handle.close() }
}
