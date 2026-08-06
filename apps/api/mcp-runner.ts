import type { ExternalDeckUpdate, McpToolResponse } from '@ark/contracts'
import {
  MCP_TOOL_CATALOG,
  isMcpToolName,
  type McpToolName,
} from '@ark/deck-core/mcp-tool-catalog.ts'
import { createActiveDeckTools } from './deck-tool-catalog.ts'
import type { DeckStore } from './deck-record.ts'
import { createDeckWorkspace } from './deck-workspace.ts'
import { parseDeckStructure } from './deck-html.ts'
import { WorkspaceDocumentConflictError } from './workspace-store.ts'
import type { McpServiceState } from './mcp-service.ts'

type ToolExecute = (input: unknown, options: unknown) => Promise<unknown>

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

function summarize(name: string, output: Record<string, unknown>) {
  if (typeof output.message === 'string') return output.message
  if (typeof output.summary === 'string') return output.summary
  if (typeof output.error === 'string') return output.error
  if (name === 'get_active_deck') return `Active deck: ${String(output.title)}`
  if (typeof output.slideCount === 'number') return `${output.slideCount} slide(s).`
  return `${name} completed.`
}

function response(name: string, output: Record<string, unknown>, isError = false): McpToolResponse {
  return {
    text:
      isError || MCP_TOOL_CATALOG[name as McpToolName]?.mutating
        ? summarize(name, output)
        : JSON.stringify(output),
    structuredContent: output,
    ...(isError ? { isError: true } : {}),
  }
}

export function createMcpRunner(options: {
  deckStore: DeckStore
  state: McpServiceState
  onDocumentPersisted?: (deckId: string, documentRevision: number) => void
  onExternalDeckUpdate?: (update: ExternalDeckUpdate) => void
}) {
  const { deckStore, state, onDocumentPersisted, onExternalDeckUpdate } = options

  const resolveActiveDeck = async (requestedDeckId?: unknown) => {
    const activeDeckId = state.getActiveDeck()
    if (!activeDeckId) {
      throw new McpRunnerError('NO_ACTIVE_DECK', 'Open a presentation in Ark and retry.', 409)
    }
    if (requestedDeckId !== undefined && requestedDeckId !== activeDeckId) {
      throw new McpRunnerError(
        'DECK_NOT_ACTIVE',
        'That presentation is no longer visible in Ark. Call get_active_deck and retry.',
        409,
      )
    }
    const deck = await deckStore.getDeck(activeDeckId)
    if (!deck) {
      state.setActiveDeck(null)
      throw new McpRunnerError('NO_ACTIVE_DECK', 'Open a presentation in Ark and retry.', 409)
    }
    return deck
  }

  return async function runMcpTool(
    rawName: string,
    rawArguments: Record<string, unknown>,
    clientName: string | null,
  ): Promise<McpToolResponse> {
    if (!state.isRunning()) {
      throw new McpRunnerError(
        'MCP_DISABLED',
        'MCP access is stopped in Ark. Start it from Ark and retry.',
        503,
      )
    }
    if (!isMcpToolName(rawName)) {
      throw new McpRunnerError('UNKNOWN_TOOL', `Unknown Ark tool: ${rawName}`, 404)
    }

    const name: McpToolName = rawName
    const parsed = MCP_TOOL_CATALOG[name].inputSchema.safeParse(rawArguments)
    if (!parsed.success) {
      throw new McpRunnerError(
        'INVALID_TOOL_ARGUMENTS',
        parsed.error.issues[0]?.message ?? 'Invalid tool arguments.',
      )
    }

    const requested = parsed.data as Record<string, unknown>
    const deck = await resolveActiveDeck(requested.deckId)
    if (name === 'get_active_deck') {
      const parsedDeck = parseDeckStructure(deck.html)
      return response(name, {
        deckId: deck.id,
        title: deck.title,
        documentRevision: deck.documentRevision,
        slideCount: parsedDeck.slideCount,
        mcpStatus: 'running',
      })
    }

    const definition = MCP_TOOL_CATALOG[name]
    if (definition.mutating && requested.expectedDocumentRevision !== deck.documentRevision) {
      throw new McpRunnerError(
        'DOCUMENT_CONFLICT',
        'The deck changed. Re-read it and retry against the latest revision.',
        409,
        { currentDocumentRevision: deck.documentRevision },
      )
    }

    const { deckId: _deckId, expectedDocumentRevision: _revision, ...toolArguments } = requested
    const workspace = createDeckWorkspace(deck.html)
    const { tools } = createActiveDeckTools(workspace)
    const registeredTool = tools[name as keyof typeof tools]
    const execute = registeredTool?.execute as ToolExecute | undefined
    if (!execute) throw new McpRunnerError('UNKNOWN_TOOL', `Unknown Ark tool: ${name}`, 404)
    const rawOutput = await execute(toolArguments, {})
    const output =
      rawOutput && typeof rawOutput === 'object'
        ? (rawOutput as Record<string, unknown>)
        : { result: rawOutput }
    const failed = 'error' in output || output.ok === false

    if (!workspace.changed || failed) {
      return response(
        name,
        { deckId: deck.id, documentRevision: deck.documentRevision, ...output },
        failed,
      )
    }

    if (!state.isRunning()) {
      throw new McpRunnerError(
        'MCP_DISABLED',
        'MCP access was stopped before this edit could be saved. Start MCP and retry.',
        503,
      )
    }
    if (state.getActiveDeck() !== deck.id) {
      throw new McpRunnerError(
        'DECK_NOT_ACTIVE',
        'That presentation is no longer visible in Ark. Call get_active_deck and retry.',
        409,
      )
    }

    try {
      const updated = await deckStore.updateDeck(deck.id, workspace.html, {
        expectedDocumentRevision: deck.documentRevision,
      })
      if (!updated) throw new McpRunnerError('NO_ACTIVE_DECK', 'The active deck was closed.', 409)
      const summary = summarize(name, output)
      onDocumentPersisted?.(updated.id, updated.documentRevision)
      onExternalDeckUpdate?.({
        deckId: updated.id,
        previousDocumentRevision: deck.documentRevision,
        documentRevision: updated.documentRevision,
        clientName,
        toolName: name,
        summary,
      })
      return response(name, {
        deckId: updated.id,
        previousDocumentRevision: deck.documentRevision,
        documentRevision: updated.documentRevision,
        ...output,
      })
    } catch (error) {
      if (error instanceof WorkspaceDocumentConflictError) {
        throw new McpRunnerError('DOCUMENT_CONFLICT', error.message, 409, {
          currentDocumentRevision: error.currentDocumentRevision,
        })
      }
      throw error
    }
  }
}
