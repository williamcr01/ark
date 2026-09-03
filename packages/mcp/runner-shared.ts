import type { McpToolResponse } from '@ark/contracts'
import { McpInteractionError } from './interactions.ts'
import { type McpToolName, MCP_TOOL_CATALOG } from './tool-catalog.ts'

export class McpRunnerError extends Error {
  readonly code: string
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(code: string, message: string, status = 400, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'McpRunnerError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function summarizeMcpOutput(name: string, output: Record<string, unknown>) {
  if (typeof output.message === 'string') return output.message
  if (typeof output.summary === 'string') return output.summary
  if (typeof output.error === 'string') return output.error
  if (name === 'get_active_deck') return `Active deck: ${String(output.title)}`
  if (typeof output.slideCount === 'number') return `${output.slideCount} slide(s).`
  return `${name} completed.`
}

export function mcpToolResponse(
  name: string,
  output: Record<string, unknown>,
  isError = false,
): McpToolResponse {
  return {
    text:
      isError || MCP_TOOL_CATALOG[name as McpToolName]?.mutating
        ? summarizeMcpOutput(name, output)
        : JSON.stringify(output),
    structuredContent: output,
    ...(isError ? { isError: true } : {}),
  }
}

export function throwMcpInteractionError(error: unknown): never {
  if (error instanceof McpInteractionError) {
    throw new McpRunnerError(error.code, error.message, 409)
  }
  throw error
}
