import type { ExternalDeckUpdate, McpToolResponse } from '@ark/contracts'
import type { AgentQuestionRequest } from '@ark/chat/agent-questions.ts'
import type { ThemeProposalRequest } from '@ark/chat/agent-themes.ts'
import { formatDeckThemeSummary, THEME_REFRESH_PROMPT } from '@ark/chat/agent-themes.ts'
import { isMcpThemeRefreshAnswer } from '@ark/contracts'
import { MCP_TOOL_CATALOG, isMcpToolName, type McpToolName } from './tool-catalog.ts'
import { createActiveDeckTools } from '@ark/agent/tool-catalog.ts'
import type { DeckStore } from '@ark/storage/records/deck-record.ts'
import { createDeckWorkspace } from '@ark/agent/workspace.ts'
import { parseDeckStructure } from '@ark/agent/document.ts'
import { buildMcpAuthoringGuide } from './guides.ts'
import { WorkspaceDocumentConflictError } from '@ark/storage/stores/workspace-store.ts'
import type { McpServiceState } from './service.ts'
import {
  createMcpInteractionStore,
  McpInteractionError,
  type McpInteractionStore,
} from './interactions.ts'

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

function interactionError(error: unknown): never {
  if (error instanceof McpInteractionError) {
    throw new McpRunnerError(error.code, error.message, 409)
  }
  throw error
}

export function createMcpRunner(options: {
  deckStore: DeckStore
  state: McpServiceState
  interactionStore?: McpInteractionStore
  onDocumentPersisted?: (deckId: string, documentRevision: number) => void
  onExternalDeckUpdate?: (update: ExternalDeckUpdate) => void
}) {
  const { deckStore, state, onDocumentPersisted, onExternalDeckUpdate } = options
  const interactionStore = options.interactionStore ?? createMcpInteractionStore()

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
    clientSessionId = clientName ?? 'anonymous',
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
    if (name === 'get_authoring_guide') {
      const guide = buildMcpAuthoringGuide()
      return {
        text: guide,
        structuredContent: {
          format: 'text/markdown',
          bytes: new TextEncoder().encode(guide).byteLength,
        },
      }
    }

    if (name === 'wait_for_interaction') {
      try {
        const result = await interactionStore.wait(
          String(requested.interactionId),
          clientSessionId,
          typeof requested.timeoutMs === 'number' ? requested.timeoutMs : undefined,
        )
        if (result.status === 'answered' && result.answer?.kind === 'questions') {
          return {
            text: `The user answered in Ark:\n${JSON.stringify(result.answer.answers)}`,
            activitySummary: 'Received answers to an MCP question interaction.',
            structuredContent: result,
          }
        }
        if (result.status === 'answered' && result.answer?.kind === 'themes') {
          if (isMcpThemeRefreshAnswer(result.answer)) {
            return {
              text: `The user asked for different theme directions in Ark. Call propose_themes again with four new, visually distinct options. ${THEME_REFRESH_PROMPT}`,
              activitySummary: 'Received an MCP theme refresh request.',
              structuredContent: result,
            }
          }
          const lines = [
            `The user chose theme id "${result.answer.themeId}" in Ark.`,
            formatDeckThemeSummary(result.answer.theme),
            'Embed this exact spec as <script type="application/json" data-ark-theme>, materialize its CSS variables, and classify every slide with data-ark-slide-kind and data-ark-layout matching the recipes.',
          ]
          return {
            text: lines.join('\n'),
            activitySummary: 'Received an MCP theme choice.',
            structuredContent: result,
          }
        }
        return {
          text:
            result.status === 'pending'
              ? 'The user has not responded in Ark yet. Call wait_for_interaction again.'
              : (result.reason ?? `The interaction is ${result.status}.`),
          activitySummary: `MCP interaction is ${result.status}.`,
          structuredContent: result,
        }
      } catch (error) {
        interactionError(error)
      }
    }

    const deck = await resolveActiveDeck(requested.deckId)
    if (name === 'get_active_deck') {
      const parsedDeck = parseDeckStructure(deck.html)
      return response(name, {
        deckId: deck.id,
        title: deck.title,
        documentRevision: deck.documentRevision,
        slideCount: parsedDeck.slideCount,
        origin: deck.origin,
        isBlank: deck.origin === 'blank',
        mcpStatus: 'running',
      })
    }

    const definition = MCP_TOOL_CATALOG[name]
    const requiresRevision = definition.mutating || name === 'ask_user' || name === 'propose_themes'
    if (requiresRevision && requested.expectedDocumentRevision !== deck.documentRevision) {
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

    if (!failed && (name === 'ask_user' || name === 'propose_themes')) {
      try {
        const interaction = interactionStore.create(
          name === 'ask_user'
            ? {
                kind: 'questions',
                deckId: deck.id,
                baseDocumentRevision: deck.documentRevision,
                clientName,
                request: toolArguments as AgentQuestionRequest,
              }
            : {
                kind: 'themes',
                deckId: deck.id,
                baseDocumentRevision: deck.documentRevision,
                clientName,
                request: toolArguments as ThemeProposalRequest,
              },
          clientSessionId,
        )
        return {
          text: `The interaction is visible in Ark. Call wait_for_interaction with interactionId "${interaction.id}" until the user responds.`,
          activitySummary:
            name === 'ask_user'
              ? 'Waiting for user answers in Ark.'
              : 'Waiting for a theme choice in Ark.',
          structuredContent: {
            interactionId: interaction.id,
            status: 'pending',
            kind: interaction.kind,
            expiresAt: interaction.expiresAt,
          },
        }
      } catch (error) {
        interactionError(error)
      }
    }

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
        historySource: 'mcp',
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
