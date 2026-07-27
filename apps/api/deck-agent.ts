import { isLoopFinished, streamText, type LanguageModel } from 'ai'

import {
  type AgentStep,
  type ApiChatMessage,
  type ChatMessagePart,
  type EditorSelectionContext,
  type JsonValue,
} from '@ark/deck-core/chat.ts'
import { assembleDeckAgentContext } from '@ark/deck-core/chat-context.ts'
import type { ProviderCallMetrics, ReasoningEffort } from '@ark/deck-core/generation-job.ts'
import { buildRuntimeRegistryPromptSection } from '@ark/runtime-registry/deck-runtime-registry.ts'
import { buildAgentGuidesPromptSection, getAgentGuidesMetadata } from './agent-guides.ts'
import { createDeckWorkspace } from './deck-workspace.ts'
import { type DeckAttachmentInspector, type DeckVersionInspector } from './deck-tools.ts'
import { extractHtmlDocument, finalizeGeneratedDeck } from './generate-response.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'
import type { Logger } from './observability/logger.ts'
import {
  createActiveDeckTools,
  findToolDefinition,
  normalizeTranscriptValue,
  type DeckToolDefinition,
} from './deck-tool-catalog.ts'
import { buildReasoningProviderOptions } from './reasoning-options.ts'

export function buildDeckAgentSystemPrompt() {
  const core = `You are Ark, an expert presentation designer and front-end engineer.

You edit slide decks as a single self-contained HTML document using the provided tools.
When attachment tools are available, list and read the relevant files before designing from them.

Approved runtime libraries (Ark-served only — use exact pinned URLs, never CDNs):
${buildRuntimeRegistryPromptSection()}

When you finish, reply briefly in plain language summarizing what changed. Do not paste the full HTML in your final message — the tools already updated the deck.`
  const guides = buildAgentGuidesPromptSection()
  if (!guides) return core
  return `${core}\n\n---\n\n# Reference guides\n\n${guides}`
}

export type RunDeckAgentOptions = {
  model: LanguageModel
  provider?: string | null
  modelRef?: string | null
  messages: ApiChatMessage[]
  currentHtml: string
  editorSelection?: EditorSelectionContext
  reasoningEffort?: ReasoningEffort
  abortSignal?: AbortSignal
  onStepProgress?: (steps: AgentStep[]) => void | Promise<void>
  logger?: Logger
  versionInspector?: DeckVersionInspector
  attachmentInspector?: DeckAttachmentInspector
}

function buildProviderMetrics(input: {
  provider: string
  modelRef: string
  latencyMs: number
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  finishReason?: string | null
  errorCategory?: string | null
}): ProviderCallMetrics {
  return {
    latencyMs: input.latencyMs,
    model: input.modelRef,
    provider: input.provider,
    tokenUsage: input.usage
      ? {
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          totalTokens: input.usage.totalTokens,
        }
      : null,
    finishReason: input.finishReason ?? null,
    retryCount: 0,
    errorCategory: input.errorCategory ?? null,
  }
}

export type RunDeckAgentResult =
  | {
      ok: true
      html: string
      changed?: boolean
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

function summarizeToolInput(toolName: string, input: unknown) {
  if (!input || typeof input !== 'object') {
    return ''
  }

  const record = input as Record<string, unknown>

  switch (toolName) {
    case 'read_deck': {
      if (typeof record.slideIndex === 'number') {
        return `slide ${record.slideIndex}`
      }

      const offset = typeof record.offset === 'number' ? record.offset : 1
      const limit = typeof record.limit === 'number' ? record.limit : 'default'
      return `lines ${offset}–${limit}`
    }
    case 'edit_deck':
      return `${Array.isArray(record.edits) ? record.edits.length : 0} patch(es)`
    case 'patch_deck':
    case 'patch_element':
      return `${Array.isArray(record.operations) ? record.operations.length : 0} op(s)`
    case 'write_deck':
      return 'full deck'
    case 'list_slides':
    case 'parse_deck':
      return 'outline'
    default:
      return ''
  }
}

function summarizeToolOutput(toolName: string, output: unknown) {
  if (!output || typeof output !== 'object') {
    return 'Done'
  }

  const record = output as Record<string, unknown>

  if (typeof record.error === 'string') {
    return record.error
  }

  if (typeof record.message === 'string') {
    return record.message
  }

  switch (toolName) {
    case 'list_slides':
    case 'parse_deck':
      return `${typeof record.slideCount === 'number' ? record.slideCount : 0} slide(s)`
    case 'read_deck':
      if (record.mode === 'slide' && typeof record.title === 'string') {
        return record.title
      }
      return `${typeof record.totalLines === 'number' ? record.totalLines : '?'} lines`
    case 'edit_deck':
      return typeof record.appliedCount === 'number'
        ? `Applied ${record.appliedCount} edit(s)`
        : 'Edit complete'
    case 'patch_deck':
    case 'patch_element':
      if (typeof record.summary === 'string' && record.summary) {
        return record.summary
      }
      return typeof record.appliedCount === 'number'
        ? `Applied ${record.appliedCount} operation(s)`
        : 'Patch complete'
    case 'write_deck':
      return typeof record.slideCount === 'number'
        ? `${record.slideCount} slide(s) written`
        : 'Deck written'
    default:
      return 'Done'
  }
}

export function extractAgentSteps(
  steps: Array<{
    text: string
    reasoningText?: string | null
    reasoning?: Array<{ text?: string } | string> | null
    toolCalls: Array<{ toolName: string; input: unknown }>
    toolResults: Array<{ toolName: string; output: unknown }>
    content?: Array<Record<string, unknown>>
  }>,
  definitions?: readonly DeckToolDefinition[],
): AgentStep[] {
  const events: AgentStep[] = []

  for (const step of steps) {
    const thinking = extractThinkingText(step)
    if (thinking) {
      events.push({ type: 'thinking', summary: thinking })
    }

    if (step.text.trim()) {
      events.push({ type: 'text', summary: step.text.trim() })
    }

    for (const toolCall of step.toolCalls) {
      const definition = definitions && findToolDefinition(definitions, toolCall.toolName)
      events.push({
        type: 'tool-call',
        toolName: toolCall.toolName,
        summary:
          definition?.summarizeInput(toolCall.input) ??
          summarizeToolInput(toolCall.toolName, toolCall.input),
      })
    }

    for (const toolResult of step.toolResults) {
      const definition = definitions && findToolDefinition(definitions, toolResult.toolName)
      const summary =
        definition?.summarizeOutput(toolResult.output) ??
        summarizeToolOutput(toolResult.toolName, toolResult.output)
      const isError =
        definition?.isErrorOutput(toolResult.output) ??
        (!!toolResult.output &&
          typeof toolResult.output === 'object' &&
          ('error' in toolResult.output ||
            ('ok' in toolResult.output && toolResult.output.ok === false)))

      events.push({
        type: 'tool-result',
        toolName: toolResult.toolName,
        summary,
        error: isError,
      })
    }

    for (const item of step.content ?? []) {
      if (item.type !== 'tool-error' || typeof item.toolName !== 'string') continue
      const error = item.error
      events.push({
        type: 'tool-result',
        toolName: item.toolName,
        summary:
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Tool execution failed',
        error: true,
      })
    }
  }

  return events
}

const projectionMetadata = (projection: {
  truncated: boolean
  recovery?: { toolName: string; input: JsonValue; instruction: string }
}) => ({
  ...(projection.truncated ? { truncated: true } : {}),
  ...(projection.recovery ? { recovery: projection.recovery } : {}),
})

export function extractAgentTranscriptParts(
  steps: Array<{
    content?: Array<Record<string, unknown>>
    text?: string
    reasoningText?: string | null
    reasoning?: Array<{ text?: string } | string> | null
    toolCalls?: Array<Record<string, unknown>>
    toolResults?: Array<Record<string, unknown>>
  }>,
  definitions: readonly DeckToolDefinition[],
): ChatMessagePart[] {
  const parts: ChatMessagePart[] = []
  for (const [stepIndex, step] of steps.entries()) {
    const thinking = extractThinkingText(step)
    if (thinking) parts.push({ type: 'thinking', content: thinking, stepIndex })

    const content = step.content ?? []
    for (const item of content) {
      if (item.type === 'text' && typeof item.text === 'string' && item.text.trim())
        parts.push({ type: 'text', content: item.text.trim(), stepIndex })
      if (
        item.type === 'tool-call' &&
        typeof item.toolCallId === 'string' &&
        typeof item.toolName === 'string'
      ) {
        const definition = findToolDefinition(definitions, item.toolName)
        if (!definition) continue
        const projection = definition.projectInputForTranscript(item.input)
        parts.push({
          type: 'tool-call',
          toolName: item.toolName,
          toolCallId: item.toolCallId,
          stepIndex,
          summary: definition.summarizeInput(item.input),
          input: projection.value,
          mutating: definition.mutating,
          ...projectionMetadata(projection),
        })
      }
      if (
        (item.type === 'tool-result' || item.type === 'tool-error') &&
        typeof item.toolCallId === 'string' &&
        typeof item.toolName === 'string'
      ) {
        const definition = findToolDefinition(definitions, item.toolName)
        if (!definition) continue
        const projection =
          item.type === 'tool-error'
            ? { value: normalizeTranscriptValue(item.error), truncated: false }
            : definition.projectOutputForTranscript(item.output)
        parts.push({
          type: 'tool-result',
          toolName: item.toolName,
          toolCallId: item.toolCallId,
          stepIndex,
          summary:
            item.type === 'tool-error'
              ? item.error instanceof Error
                ? item.error.message
                : 'Tool execution failed'
              : definition.summarizeOutput(item.output),
          output: projection.value,
          mutating: definition.mutating,
          ...projectionMetadata(projection),
          isError: item.type === 'tool-error' || definition.isErrorOutput(item.output),
          error: item.type === 'tool-error' || definition.isErrorOutput(item.output),
        })
      }
    }
    if (!content.length) {
      if (step.text?.trim()) parts.push({ type: 'text', content: step.text.trim(), stepIndex })
      for (const call of step.toolCalls ?? []) {
        if (typeof call.toolCallId !== 'string' || typeof call.toolName !== 'string') continue
        const definition = findToolDefinition(definitions, call.toolName)
        if (!definition) continue
        const projection = definition.projectInputForTranscript(call.input)
        parts.push({
          type: 'tool-call',
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          stepIndex,
          summary: definition.summarizeInput(call.input),
          input: projection.value,
          mutating: definition.mutating,
          ...projectionMetadata(projection),
        })
      }
      for (const result of step.toolResults ?? []) {
        if (typeof result.toolCallId !== 'string' || typeof result.toolName !== 'string') continue
        const definition = findToolDefinition(definitions, result.toolName)
        if (!definition) continue
        const projection = definition.projectOutputForTranscript(result.output)
        parts.push({
          type: 'tool-result',
          toolName: result.toolName,
          toolCallId: result.toolCallId,
          stepIndex,
          summary: definition.summarizeOutput(result.output),
          output: projection.value,
          mutating: definition.mutating,
          ...projectionMetadata(projection),
          isError: definition.isErrorOutput(result.output),
          error: definition.isErrorOutput(result.output),
        })
      }
    }
  }
  return parts
}

export function extractThinkingText(step: {
  reasoningText?: string | null
  reasoning?: Array<{ text?: string } | string> | null
}): string {
  const fromText = step.reasoningText?.trim()
  if (fromText) {
    return fromText
  }

  if (!step.reasoning?.length) {
    return ''
  }

  return step.reasoning
    .map((part) => (typeof part === 'string' ? part : (part.text ?? '')))
    .join('')
    .trim()
}

const THINKING_PROGRESS_THROTTLE_MS = 200

function createThinkingProgressReporter(
  accumulatedSteps: AgentStep[],
  onStepProgress?: (steps: AgentStep[]) => void | Promise<void>,
) {
  let thinkingBuffer = ''
  let thinkingStartedAt: number | null = null
  let lastFlushAt = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let pendingFlush: Promise<void> = Promise.resolve()

  const withThinking = () => {
    const steps = [...accumulatedSteps]
    if (thinkingBuffer) {
      steps.push({ type: 'thinking', summary: thinkingBuffer })
    }
    return steps
  }

  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }

    lastFlushAt = Date.now()
    pendingFlush = pendingFlush.then(async () => {
      await onStepProgress?.(withThinking())
    })
    return pendingFlush
  }

  const scheduleFlush = () => {
    const elapsed = Date.now() - lastFlushAt
    if (elapsed >= THINKING_PROGRESS_THROTTLE_MS) {
      void flush()
      return
    }

    if (flushTimer) {
      return
    }

    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, THINKING_PROGRESS_THROTTLE_MS - elapsed)
  }

  return {
    appendDelta(text: string) {
      if (!text) {
        return
      }

      if (thinkingStartedAt === null) {
        thinkingStartedAt = Date.now()
      }
      thinkingBuffer += text
      scheduleFlush()
    },
    /** Finalize in-progress thinking (from deltas or finished-step text) into accumulatedSteps. */
    async commitThinkingStep(fallbackText?: string) {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }

      await pendingFlush

      const summary = (thinkingBuffer || fallbackText || '').trim()
      const startedAt = thinkingStartedAt
      thinkingBuffer = ''
      thinkingStartedAt = null

      if (summary) {
        // In-progress flushes omit durationMs; commit always sets it so the UI can
        // switch from "Thinking" to "Thought for X seconds".
        accumulatedSteps.push({
          type: 'thinking',
          summary,
          durationMs: startedAt !== null ? Math.max(0, Date.now() - startedAt) : 0,
        })
      }
    },
  }
}

function throwIfAborted(abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) {
    throw new DOMException('Generation canceled.', 'AbortError')
  }
}

function canAcceptSelectionNoopReply(input: {
  currentHtml: string
  editorSelection?: EditorSelectionContext
  assistantText: string
  extractedText: string
}) {
  return (
    !!input.editorSelection &&
    !!input.currentHtml.trim() &&
    !!input.assistantText &&
    input.extractedText === input.assistantText &&
    !/<html[\s>]/i.test(input.assistantText) &&
    !/<!doctype html>/i.test(input.assistantText)
  )
}

type ExtractableAgentStep = Parameters<typeof extractAgentSteps>[0][number]

export async function runDeckAgent({
  model,
  provider: providerInput = 'unknown',
  modelRef: modelRefInput = 'unknown',
  messages,
  currentHtml,
  editorSelection,
  reasoningEffort,
  abortSignal,
  onStepProgress,
  logger,
  versionInspector,
  attachmentInspector,
}: RunDeckAgentOptions): Promise<RunDeckAgentResult> {
  const provider = providerInput ?? 'unknown'
  const modelRef = modelRefInput ?? 'unknown'
  throwIfAborted(abortSignal)

  const workspace = createDeckWorkspace(currentHtml)
  const { tools, activeDefinitions } = createActiveDeckTools(workspace, {
    logger,
    versionInspector,
    attachmentInspector,
  })
  const accumulatedSteps: AgentStep[] = []
  const transcriptParts: ChatMessagePart[] = []
  let transcriptStepIndex = 0
  const thinkingProgress = createThinkingProgressReporter(accumulatedSteps, onStepProgress)
  const startedAt = performance.now()
  const context = assembleDeckAgentContext({ messages, currentHtml, editorSelection })
  const guideMetadata = getAgentGuidesMetadata()
  logger?.info('generation.context.assembled', {
    ...context.metadata,
    ...guideMetadata,
  })
  const providerOptions = reasoningEffort
    ? buildReasoningProviderOptions(provider, reasoningEffort, modelRef)
    : undefined

  let result

  try {
    let streamError: unknown
    const stream = streamText({
      model,
      system: buildDeckAgentSystemPrompt(),
      messages: context.modelMessages,
      tools,
      stopWhen: isLoopFinished(),
      // Legacy fallback for callers that omit reasoningEffort (the UI always sends one).
      ...(reasoningEffort || provider === 'google' ? {} : { temperature: 0.4 }),
      ...(providerOptions && Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
      abortSignal,
      onError: ({ error }) => {
        streamError ??= error
      },
      onChunk: async ({ chunk }) => {
        throwIfAborted(abortSignal)
        if (chunk.type === 'reasoning-delta') {
          thinkingProgress.appendDelta(chunk.text)
        }
      },
      onStepFinish: async (step) => {
        throwIfAborted(abortSignal)
        const thinkingBeforeCount = accumulatedSteps.length
        await thinkingProgress.commitThinkingStep(extractThinkingText(step as ExtractableAgentStep))
        const committedThinking =
          accumulatedSteps.length > thinkingBeforeCount &&
          accumulatedSteps[thinkingBeforeCount]?.type === 'thinking'
            ? accumulatedSteps[thinkingBeforeCount]
            : null

        const withoutThinking = extractAgentSteps(
          [step as ExtractableAgentStep],
          activeDefinitions,
        ).filter((event) => event.type !== 'thinking')
        accumulatedSteps.push(...withoutThinking)

        const extracted: ChatMessagePart[] = extractAgentTranscriptParts(
          [step as never],
          activeDefinitions,
        )
          .filter((part) => part.type !== 'thinking')
          .map((part) => ({ ...part, stepIndex: transcriptStepIndex }))
        if (committedThinking) {
          extracted.unshift({
            type: 'thinking',
            content: committedThinking.summary,
            stepIndex: transcriptStepIndex,
            ...(committedThinking.durationMs !== undefined
              ? { durationMs: committedThinking.durationMs }
              : {}),
          })
        }
        transcriptParts.push(...extracted)
        transcriptStepIndex += 1
        await onStepProgress?.(accumulatedSteps)
      },
    })

    // Drain the stream so tool loops and progress callbacks run to completion.
    await stream.consumeStream()
    if (streamError) {
      throw streamError
    }
    result = {
      text: await stream.text,
      steps: await stream.steps,
      totalUsage: await stream.totalUsage,
      finishReason: await stream.finishReason,
    }
    const trailingThinkingBefore = accumulatedSteps.length
    await thinkingProgress.commitThinkingStep()
    if (
      accumulatedSteps.length > trailingThinkingBefore &&
      accumulatedSteps[trailingThinkingBefore]?.type === 'thinking'
    ) {
      const trailingThinking = accumulatedSteps[trailingThinkingBefore]
      transcriptParts.push({
        type: 'thinking',
        content: trailingThinking.summary,
        stepIndex: transcriptStepIndex,
        ...(trailingThinking.durationMs !== undefined
          ? { durationMs: trailingThinking.durationMs }
          : {}),
      })
    }
  } catch (error) {
    const { categorizeProviderError } = await import('./observability/provider-errors.ts')
    const details = categorizeProviderError(error)

    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Model provider request failed.',
      steps: accumulatedSteps,
      transcriptParts,
      providerMetrics: buildProviderMetrics({
        provider,
        modelRef,
        latencyMs: Math.round(performance.now() - startedAt),
        errorCategory: details.category,
      }),
    }
  }

  const providerMetrics = buildProviderMetrics({
    provider,
    modelRef,
    latencyMs: Math.round(performance.now() - startedAt),
    usage: {
      inputTokens: result.totalUsage.inputTokens,
      outputTokens: result.totalUsage.outputTokens,
      totalTokens: result.totalUsage.totalTokens,
    },
    finishReason: result.finishReason,
  })

  throwIfAborted(abortSignal)

  const steps =
    accumulatedSteps.length > 0
      ? accumulatedSteps
      : extractAgentSteps(result.steps as ExtractableAgentStep[], activeDefinitions)
  const assistantText = result.text.trim()
  const finalTranscriptParts =
    transcriptParts.length > 0
      ? transcriptParts
      : extractAgentTranscriptParts(result.steps as never, activeDefinitions)

  if (workspace.changed && workspace.html.trim()) {
    const validation = validateDeckHtmlOnServer(workspace.html, logger ? { logger } : {})

    if (!validation.valid) {
      const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')

      return {
        ok: false,
        error:
          primaryIssue?.message ??
          'The agent produced an invalid deck. Try a more specific edit request.',
        steps,
        transcriptParts: finalTranscriptParts,
        validation,
        providerMetrics,
      }
    }

    return {
      ok: true,
      html: workspace.html,
      changed: true,
      validation,
      steps,
      transcriptParts: finalTranscriptParts,
      assistantText,
      providerMetrics,
    }
  }

  const fallback = finalizeGeneratedDeck(result.text)

  if (fallback.ok) {
    return {
      ok: true,
      html: fallback.html,
      changed: true,
      validation: fallback.validation,
      steps,
      transcriptParts: finalTranscriptParts,
      assistantText,
      providerMetrics,
    }
  }

  const extracted = extractHtmlDocument(result.text)

  if (extracted !== result.text.trim() && extracted.includes('<html')) {
    const extractedFinal = finalizeGeneratedDeck(extracted)

    if (extractedFinal.ok) {
      return {
        ok: true,
        html: extractedFinal.html,
        changed: true,
        validation: extractedFinal.validation,
        steps,
        transcriptParts: finalTranscriptParts,
        assistantText,
        providerMetrics,
      }
    }
  }

  if (
    canAcceptSelectionNoopReply({
      currentHtml,
      editorSelection,
      assistantText,
      extractedText: extracted,
    })
  ) {
    const validation = validateDeckHtmlOnServer(currentHtml, logger ? { logger } : {})

    if (validation.valid) {
      return {
        ok: true,
        html: currentHtml,
        changed: false,
        validation,
        steps,
        transcriptParts: finalTranscriptParts,
        assistantText,
        providerMetrics,
      }
    }
  }

  return {
    ok: false,
    error:
      fallback.error ??
      'The agent did not update the deck. Ask for a specific change or try again.',
    steps,
    transcriptParts: finalTranscriptParts,
    validation: fallback.validation,
    providerMetrics,
  }
}
