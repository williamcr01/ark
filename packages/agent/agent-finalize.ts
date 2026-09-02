import type { AgentStep, ChatMessagePart } from '@ark/chat/messages.ts'
import type { EditorSelectionContext } from '@ark/chat/context.ts'
import type { ProviderCallMetrics } from '@ark/chat/generation-job.ts'
import { validateDeckHtmlOnServer } from '@ark/deck-node/validate/timed.ts'
import type { Logger } from '@ark/telemetry/logger.ts'
import { extractHtmlDocument, finalizeGeneratedDeck } from './response.ts'
import {
  extractAgentSteps,
  extractAgentTranscriptParts,
  type ExtractableAgentStep,
} from './agent-steps.ts'
import type { DeckToolDefinition } from './tool-catalog.ts'

export type RunDeckAgentResult =
  | {
      ok: true
      html: string
      changed?: boolean
      awaitingUserResponse?: boolean
      validation: ReturnType<typeof validateDeckHtmlOnServer>
      steps: AgentStep[]
      assistantText: string
      transcriptParts: ChatMessagePart[]
      providerMetrics: ProviderCallMetrics
    }
  | {
      ok: false
      error: string
      steps: AgentStep[]
      transcriptParts: ChatMessagePart[]
      validation?: ReturnType<typeof validateDeckHtmlOnServer>
      providerMetrics?: ProviderCallMetrics | null
    }

const EMPTY_AWAITING_VALIDATION: ReturnType<typeof validateDeckHtmlOnServer> = {
  valid: true,
  slideCount: 0,
  scripts: [],
  forms: 0,
  iframes: 0,
  externalUrls: [],
  malformedSlides: [],
  runtimeMarkers: {
    runtimeMode: 'static',
    arkDeck: null,
    arkPreview: null,
    arkRuntime: null,
    arkRuntimeLib: null,
    arkRuntimeVersion: null,
    approvedRuntimeId: null,
    approvedRuntimeVersion: null,
  },
  issues: [],
}

function canAcceptSelectionNoopReply(input: {
  currentHtml: string
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
  assistantText: string
  extractedText: string
}) {
  return (
    !!(input.editorSelection || input.editorSelections?.length) &&
    !!input.currentHtml.trim() &&
    !!input.assistantText &&
    input.extractedText === input.assistantText &&
    !/<html[\s>]/i.test(input.assistantText) &&
    !/<!doctype html>/i.test(input.assistantText)
  )
}

function transcriptAwaitsUser(parts: ChatMessagePart[]) {
  return parts.some((part) => {
    if (part.type !== 'tool-result') return false
    if (part.toolName !== 'ask_user' && part.toolName !== 'propose_themes') return false
    const output = part.output
    return (
      !!output &&
      typeof output === 'object' &&
      !Array.isArray(output) &&
      (output as { awaitingUserResponse?: unknown }).awaitingUserResponse === true
    )
  })
}

function okResult(
  html: string,
  changed: boolean,
  validation: ReturnType<typeof validateDeckHtmlOnServer>,
  rest: {
    steps: AgentStep[]
    transcriptParts: ChatMessagePart[]
    assistantText: string
    providerMetrics: ProviderCallMetrics
    awaitingUserResponse?: boolean
  },
): RunDeckAgentResult {
  return {
    ok: true,
    html,
    changed,
    validation,
    ...rest,
  }
}

function finalizeChangedWorkspace(input: {
  html: string
  logger?: Logger
  steps: AgentStep[]
  transcriptParts: ChatMessagePart[]
  assistantText: string
  providerMetrics: ProviderCallMetrics
}): RunDeckAgentResult | null {
  const validation = validateDeckHtmlOnServer(
    input.html,
    input.logger ? { logger: input.logger } : {},
  )
  if (!validation.valid) {
    const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')
    return {
      ok: false,
      error:
        primaryIssue?.message ??
        'The agent produced an invalid deck. Try a more specific edit request.',
      steps: input.steps,
      transcriptParts: input.transcriptParts,
      validation,
      providerMetrics: input.providerMetrics,
    }
  }
  return okResult(input.html, true, validation, {
    steps: input.steps,
    transcriptParts: input.transcriptParts,
    assistantText: input.assistantText,
    providerMetrics: input.providerMetrics,
  })
}

function finalizeAwaitingUser(input: {
  currentHtml: string
  logger?: Logger
  steps: AgentStep[]
  transcriptParts: ChatMessagePart[]
  assistantText: string
  providerMetrics: ProviderCallMetrics
}): RunDeckAgentResult | null {
  const rest = {
    steps: input.steps,
    transcriptParts: input.transcriptParts,
    assistantText: input.assistantText,
    providerMetrics: input.providerMetrics,
    awaitingUserResponse: true as const,
  }
  if (!input.currentHtml.trim()) {
    return okResult('', false, EMPTY_AWAITING_VALIDATION, rest)
  }
  const validation = validateDeckHtmlOnServer(
    input.currentHtml,
    input.logger ? { logger: input.logger } : {},
  )
  if (validation.valid) {
    return okResult(input.currentHtml, false, validation, rest)
  }
  return null
}

function finalizeFallbackDeck(input: {
  text: string
  currentHtml: string
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
  logger?: Logger
  steps: AgentStep[]
  transcriptParts: ChatMessagePart[]
  assistantText: string
  providerMetrics: ProviderCallMetrics
}): RunDeckAgentResult {
  const fallback = finalizeGeneratedDeck(input.text)
  const rest = {
    steps: input.steps,
    transcriptParts: input.transcriptParts,
    assistantText: input.assistantText,
    providerMetrics: input.providerMetrics,
  }
  if (fallback.ok) {
    return okResult(fallback.html, true, fallback.validation, rest)
  }

  const extracted = extractHtmlDocument(input.text)
  if (extracted !== input.text.trim() && extracted.includes('<html')) {
    const extractedFinal = finalizeGeneratedDeck(extracted)
    if (extractedFinal.ok) {
      return okResult(extractedFinal.html, true, extractedFinal.validation, rest)
    }
  }

  if (
    canAcceptSelectionNoopReply({
      currentHtml: input.currentHtml,
      editorSelection: input.editorSelection,
      editorSelections: input.editorSelections,
      assistantText: input.assistantText,
      extractedText: extracted,
    })
  ) {
    const validation = validateDeckHtmlOnServer(
      input.currentHtml,
      input.logger ? { logger: input.logger } : {},
    )
    if (validation.valid) {
      return okResult(input.currentHtml, false, validation, rest)
    }
  }

  return {
    ok: false,
    error:
      fallback.error ??
      'The agent did not update the deck. Ask for a specific change or try again.',
    steps: input.steps,
    transcriptParts: input.transcriptParts,
    validation: fallback.validation,
    providerMetrics: input.providerMetrics,
  }
}

export function finalizeDeckAgentRun(input: {
  workspaceChanged: boolean
  workspaceHtml: string
  currentHtml: string
  resultText: string
  resultSteps: ExtractableAgentStep[]
  accumulatedSteps: AgentStep[]
  transcriptParts: ChatMessagePart[]
  activeDefinitions: readonly DeckToolDefinition[]
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
  logger?: Logger
  providerMetrics: ProviderCallMetrics
}): RunDeckAgentResult {
  const steps =
    input.accumulatedSteps.length > 0
      ? input.accumulatedSteps
      : extractAgentSteps(input.resultSteps, input.activeDefinitions)
  const assistantText = input.resultText.trim()
  const finalTranscriptParts =
    input.transcriptParts.length > 0
      ? input.transcriptParts
      : extractAgentTranscriptParts(input.resultSteps as never, input.activeDefinitions)
  const shared = {
    steps,
    transcriptParts: finalTranscriptParts,
    assistantText,
    providerMetrics: input.providerMetrics,
  }

  if (input.workspaceChanged && input.workspaceHtml.trim()) {
    return finalizeChangedWorkspace({ html: input.workspaceHtml, logger: input.logger, ...shared })!
  }

  if (transcriptAwaitsUser(finalTranscriptParts)) {
    const awaiting = finalizeAwaitingUser({
      currentHtml: input.currentHtml,
      logger: input.logger,
      ...shared,
    })
    if (awaiting) return awaiting
  }

  return finalizeFallbackDeck({
    text: input.resultText,
    currentHtml: input.currentHtml,
    editorSelection: input.editorSelection,
    editorSelections: input.editorSelections,
    logger: input.logger,
    ...shared,
  })
}
