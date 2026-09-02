import type { DeckThemeSpecV1 } from '@ark/deck/document/theme.ts'
import type { Logger } from '@ark/telemetry/logger.ts'
import type { DeckWorkspace } from './workspace.ts'
import { createInspectDeckTools } from './tools/inspect.ts'
import { createInteractionDeckTools } from './tools/interact.ts'
import { createMutateDeckTools } from './tools/mutate.ts'
import type { DeckAttachmentInspector } from './tools/helpers.ts'
export type { DeckAttachmentInspector, DeckAttachmentSummary } from './tools/helpers.ts'

export function createDeckTools(
  workspace: DeckWorkspace,
  options: {
    logger?: Logger
    attachmentInspector?: DeckAttachmentInspector
    expectedTheme?: DeckThemeSpecV1 | null
  } = {},
) {
  const { logger, attachmentInspector, expectedTheme = null } = options
  return {
    ...createInspectDeckTools(workspace, logger ? { logger } : {}),
    ...createMutateDeckTools(workspace, { logger, expectedTheme }),
    ...createInteractionDeckTools({ logger, attachmentInspector }),
  }
}

export type DeckTools = ReturnType<typeof createDeckTools>
