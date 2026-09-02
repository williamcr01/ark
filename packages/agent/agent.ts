import { hasToolCall, isLoopFinished, streamText, type LanguageModel } from 'ai'

import {
  type AgentStep,
  type ApiChatMessage,
  type ChatMessagePart,
  type EditorSelectionContext,
  type JsonValue,
  type SlideContext,
} from '@ark/chat/chat.ts'
import { assembleDeckAgentContext } from '@ark/chat/chat-context.ts'
import type { DeckOrigin } from '@ark/deck/document/origin.ts'
import type { DeckThemeSpecV1 } from '@ark/deck/document/theme.ts'
import type { ProviderCallMetrics, ReasoningEffort } from '@ark/chat/generation-job.ts'
import { buildRuntimeRegistryPromptSection } from '@ark/runtime-registry/deck-runtime-registry.ts'
import { buildDeckFontPromptSection } from '@ark/runtime-registry/deck-font-registry.ts'
import { buildAgentGuidesPromptSection, getAgentGuidesMetadata } from './guides.ts'
import { wrapUserPromptForAgent } from './prompt.ts'
import { createDeckWorkspace } from './workspace.ts'
import { type DeckAttachmentInspector } from './tools.ts'
import { extractHtmlDocument, finalizeGeneratedDeck } from './response.ts'
import { validateDeckHtmlOnServer } from '@ark/deck-node/validate/timed.ts'
import type { Logger } from '@ark/telemetry/logger.ts'
import {
  createActiveDeckTools,
  findToolDefinition,
  normalizeTranscriptValue,
  type DeckToolDefinition,
} from './tool-catalog.ts'
import {
  applyAnthropicConversationCacheBreakpoints,
  buildCachedSystemPrompt,
  buildPromptCacheProviderOptions,
  mergeProviderOptions,
} from '@ark/ai/prompt-cache-options.ts'
import { normalizeProviderTokenUsage } from '@ark/ai/token-usage.ts'
import { buildReasoningProviderOptions } from '@ark/ai/reasoning-options.ts'

/** Stop only after a successful pause tool (failed propose_themes can retry in-loop). */
export function hasAwaitingUserToolResult(toolName: string) {
  return ({
    steps,
  }: {
    steps: Array<{ toolResults: Array<{ toolName: string; output: unknown } | undefined> }>
  }) => {
    const last = steps[steps.length - 1]
    return (
      last?.toolResults.some((result) => {
        if (!result || result.toolName !== toolName) return false
        const output = result.output
        return (
          !!output &&
          typeof output === 'object' &&
          !Array.isArray(output) &&
          (output as { awaitingUserResponse?: unknown }).awaitingUserResponse === true
        )
      }) ?? false
    )
  }
}

export function buildDeckAgentSystemPrompt() {
  const core = `You are Ark, an expert presentation designer and front-end engineer.

You edit slide decks as a single self-contained HTML document using the provided tools.
Call list_attachments before using attached files; it returns an empty list when this conversation has none.
Attached images are optional design inputs: place them when the user's request or the presentation design clearly calls for them, but do not force every attachment into the deck.
For an image, use the exact Ark URL returned by the attachment tools; never reproduce base64 bytes, invent an asset URL, or substitute a remote URL. Add meaningful alt text. Use object-fit: cover for photographic crops and contain for logos, diagrams, screenshots, or anything that must not be cropped.

Use ask_user when critical context is missing: ask concise questions, then stop. Never re-ask information already present in the conversation.
- New deck: the request wrapper tells you when you are starting one: either there is no deck yet, or the workspace holds an empty starter deck with no authored content. In both cases build from scratch; never treat a starter deck as the user's work, and do not read it before writing. Before generating, check whether the user's prompt already covers audience, approximate slide count, and content priorities (concise / story-led / data-heavy / visual). Ask one ask_user round for whichever of those are missing, and add other questions only if they are genuinely load-bearing for a good first draft. If the prompt already covers everything needed, skip ask_user.
- After context is clear for a NEW deck (and before write_deck), call propose_themes with exactly 4 distinct directions. Each needs a full theme spec (fonts, colors, type, spacing, slide recipes), a rationale, and a lean three-slide sample (cover, content, and one of section/data/closing) using --ark-* variables. Then stop. After the user picks a theme, write the full deck from that exact contract: embed the spec as <script type="application/json" data-ark-theme>, materialize CSS variables, and classify every slide with data-ark-slide-kind and data-ark-layout. Never re-propose unless asked.
- Existing deck: ask only when guessing would materially change the result. Call propose_themes only when the user explicitly asks to retheme the whole deck or requests new theme options. After they pick, apply that direction consistently across the deck while preserving its content and structure unless they requested broader changes.

Approved runtime libraries (Ark-served only; use exact pinned URLs, never CDNs):
${buildRuntimeRegistryPromptSection()}

${buildDeckFontPromptSection()}

When you finish, reply briefly in plain language summarizing what changed. Do not paste the full HTML in your final message; the tools already updated the deck.`
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
  /** `blank` marks Ark's untouched starter deck so the agent opens a new-deck flow. */
  deckOrigin?: DeckOrigin | null
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
  slideContexts?: SlideContext[]
  reasoningEffort?: ReasoningEffort
  /**
   * Opaque deck or chat-thread id for OpenAI prompt-cache routing.
   * Never job id, user content, or secrets.
   */
  promptCacheKey?: string | null
  abortSignal?: AbortSignal
  onStepProgress?: (steps: AgentStep[]) => void | Promise<void>
  logger?: Logger
  attachmentInspector?: DeckAttachmentInspector
}

function buildProviderMetrics(input: {
  provider: string
  modelRef: string
  latencyMs: number
  usage?: ReturnType<typeof normalizeProviderTokenUsage>
  finishReason?: string | null
  errorCategory?: string | null
}): ProviderCallMetrics {
  return {
    latencyMs: input.latencyMs,
    model: input.modelRef,
    provider: input.provider,
    tokenUsage: input.usage ?? null,
    finishReason: input.finishReason ?? null,
    retryCount: 0,
    errorCategory: input.errorCategory ?? null,
  }
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

type ExtractableAgentStep = Parameters<typeof extractAgentSteps>[0][number]

export async function runDeckAgent({
  model,
  provider: providerInput = 'unknown',
  modelRef: modelRefInput = 'unknown',
  messages,
  currentHtml,
  deckOrigin,
  editorSelection,
  editorSelections,
  slideContexts,
  reasoningEffort,
  promptCacheKey,
  abortSignal,
  onStepProgress,
  logger,
  attachmentInspector,
}: RunDeckAgentOptions): Promise<RunDeckAgentResult> {
  const provider = providerInput ?? 'unknown'
  const modelRef = modelRefInput ?? 'unknown'
  throwIfAborted(abortSignal)

  const workspace = createDeckWorkspace(currentHtml)
  const lastUser = messages.findLast((message) => message.role === 'user')
  const expectedTheme: DeckThemeSpecV1 | null = lastUser?.context?.themeSelection?.theme ?? null
  const { tools, activeDefinitions } = createActiveDeckTools(workspace, {
    logger,
    attachmentInspector,
    expectedTheme,
  })
  const accumulatedSteps: AgentStep[] = []
  const transcriptParts: ChatMessagePart[] = []
  let transcriptStepIndex = 0
  const thinkingProgress = createThinkingProgressReporter(accumulatedSteps, onStepProgress)
  const startedAt = performance.now()
  const context = assembleDeckAgentContext({
    messages,
    currentHtml,
    editorSelection,
    editorSelections,
    slideContexts,
    deckOrigin,
    wrapUserPrompt: wrapUserPromptForAgent,
  })
  const guideMetadata = getAgentGuidesMetadata()
  logger?.info('generation.context.assembled', {
    ...context.metadata,
    ...guideMetadata,
  })
  const providerOptions = mergeProviderOptions(
    reasoningEffort ? buildReasoningProviderOptions(reasoningEffort, modelRef) : undefined,
    buildPromptCacheProviderOptions({ provider, promptCacheKey }),
  )

  let result

  try {
    let streamError: unknown
    const stream = streamText({
      model,
      system: buildCachedSystemPrompt(provider, buildDeckAgentSystemPrompt()),
      messages: context.modelMessages,
      tools,
      stopWhen: [
        hasToolCall('ask_user'),
        hasAwaitingUserToolResult('propose_themes'),
        isLoopFinished(),
      ],
      ...(provider === 'anthropic'
        ? {
            prepareStep: ({ messages }) => ({
              messages: applyAnthropicConversationCacheBreakpoints(messages),
            }),
          }
        : {}),
      // Use stable sampling for models without a reasoning-effort control.
      ...(reasoningEffort || provider === 'google' ? {} : { temperature: 0.4 }),
      ...(providerOptions ? { providerOptions } : {}),
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
    const { categorizeProviderError } = await import('@ark/ai/provider-errors.ts')
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
    usage: normalizeProviderTokenUsage(result.totalUsage),
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
  const awaitingUserResponse = finalTranscriptParts.some((part) => {
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

  if (awaitingUserResponse) {
    if (!currentHtml.trim()) {
      return {
        ok: true,
        html: '',
        changed: false,
        awaitingUserResponse: true,
        validation: EMPTY_AWAITING_VALIDATION,
        steps,
        transcriptParts: finalTranscriptParts,
        assistantText,
        providerMetrics,
      }
    }

    const validation = validateDeckHtmlOnServer(currentHtml, logger ? { logger } : {})

    if (validation.valid) {
      return {
        ok: true,
        html: currentHtml,
        changed: false,
        awaitingUserResponse: true,
        validation,
        steps,
        transcriptParts: finalTranscriptParts,
        assistantText,
        providerMetrics,
      }
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
      editorSelections,
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
