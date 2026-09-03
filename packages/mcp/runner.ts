import type { ExternalDeckUpdate, McpToolResponse } from '@ark/contracts'
import type { DeckStore } from '@ark/storage/records/deck-record.ts'
import type { McpServiceState } from './service.ts'
import { createMcpInteractionStore, type McpInteractionStore } from './interactions.ts'
import { executeMcpTool } from './runner-execute.ts'
export { McpRunnerError } from './runner-shared.ts'

export function createMcpRunner(options: {
  deckStore: DeckStore
  state: McpServiceState
  interactionStore?: McpInteractionStore
  onDocumentPersisted?: (deckId: string, documentRevision: number) => void
  onExternalDeckUpdate?: (update: ExternalDeckUpdate) => void
}) {
  const { deckStore, state, onDocumentPersisted, onExternalDeckUpdate } = options
  const interactionStore = options.interactionStore ?? createMcpInteractionStore()
  const deps = { deckStore, state, interactionStore, onDocumentPersisted, onExternalDeckUpdate }

  return async function runMcpTool(
    rawName: string,
    rawArguments: Record<string, unknown>,
    clientName: string | null,
    clientSessionId = clientName ?? 'anonymous',
  ): Promise<McpToolResponse> {
    return executeMcpTool(deps, rawName, rawArguments, clientName, clientSessionId)
  }
}
