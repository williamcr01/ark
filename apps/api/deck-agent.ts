import { generateText, stepCountIs, type LanguageModel } from 'ai'

import {
  buildAgentModelMessages,
  type AgentStep,
  type ApiChatMessage,
  type EditorSelectionContext,
} from '@ark/deck-core/chat.ts'
import type { ProviderCallMetrics } from '@ark/deck-core/generation-job.ts'
import { buildRuntimeRegistryPromptSection } from '@ark/runtime-registry/deck-runtime-registry.ts'
import { createDeckWorkspace } from './deck-workspace.ts'
import { type DeckVersionInspector } from './deck-tools.ts'
import { extractHtmlDocument, finalizeGeneratedDeck } from './generate-response.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'
import type { Logger } from './observability/logger.ts'

export const AGENT_MAX_STEPS = 12

export const deckAgentSystemPrompt = `You are Ark, an expert presentation designer and front-end engineer.

You edit slide decks as a single self-contained HTML document using the provided tools.

Tool workflow:
- **New deck**: call write_deck with a complete HTML document.
- **Edit existing deck**: call parse_deck, list_slides, and/or read_deck first.
- **Selected element**: when the user has an element selected (see the selection note in their message), prefer patch_element targeting that elementId. parse_deck lists element ids, kinds, and locked/managed flags.
- **Slide changes**: prefer patch_deck (add/delete/replace/reorder/title/notes) over edit_deck or write_deck.
- **Small inline HTML tweaks**: use edit_deck with exact oldText/newText patches.
- Use write_deck only for brand-new decks or explicit full rewrites.
- If a selected element id is missing (stale) or locked, inspect the deck and pick the closest match or explain what can and cannot change instead of failing.
- After edits, you may read_deck again to verify structure before replying.

Hard requirements for deck HTML:
- Include <!DOCTYPE html>, <html>, <head>, and <body>.
- Use inline CSS inside a <style> tag. No Tailwind, npm packages, or build tooling.
- Decks must be fully self-contained: no http(s) URLs for scripts, stylesheets, fonts, or images.
- Use inline CSS, system fonts, inline SVG, or data: URIs instead of external assets.
- Design for 16:9: html/body width 100%, height 100%, margin 0, overflow hidden; active slide fills 100vw × 100vh.
- Keep copy concise and presentation-grade. Avoid lorem ipsum and generic filler.

Plain deck structure (default — prefer unless reveal.js is requested):
- Each slide is a top-level <section class="slide">. All slides in the DOM at once.
- No runtime markers required; Ark injects CSS-only navigation.

Preview modes:
- Plain CSS (default): no marker — Ark injects navigation; deck scripts are stripped.
- Custom full-JS: set data-ark-deck="nav" on <html> when the deck owns navigation.
- When using data-ark-deck="nav", follow the Ark deck bridge protocol in docs/deck-bridge.md.
- Listen for CustomEvent "ark:deck-goto" with detail.index from the Ark bridge.
- Dispatch CustomEvent "ark:deck-slide-change" with detail.index on every slide change. Do not call window.parent.postMessage.
- External JavaScript libraries are only acceptable if inlined in the HTML or served via approved runtime URLs below; never use CDN script URLs.

Approved runtime libraries (Ark-served only — use exact pinned URLs, never CDNs):
${buildRuntimeRegistryPromptSection()}

Reveal.js rules (only when requested or clearly needed — see docs/reveal-runtime.md):
- Set data-ark-runtime="reveal", data-ark-runtime-lib="reveal.js", and data-ark-runtime-version="5.1.0" on <html>.
- Use .reveal > .slides > section structure; do not use section.slide for reveal decks.
- Include all required runtime CSS and JS URLs from the registry list above.
- Do not add deck-authored bridge scripts, Reveal.initialize(), or reveal plugins — Ark injects the reveal adapter in preview.
- Do not promise fragment step-through, speaker-notes UI, or reveal themes other than theme/white.css.
- CDN reveal.js URLs are invalid even if the version matches.

When you finish, reply briefly in plain language summarizing what changed. Do not paste the full HTML in your final message — the tools already updated the deck.`

export type RunDeckAgentOptions = {
  model: LanguageModel
  provider?: string | null
  modelRef?: string | null
  messages: ApiChatMessage[]
  currentHtml: string
  editorSelection?: EditorSelectionContext
  abortSignal?: AbortSignal
  onStepProgress?: (steps: AgentStep[]) => void | Promise<void>
  logger?: Logger
  versionInspector?: DeckVersionInspector
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
      providerMetrics: ProviderCallMetrics
    }
  | {
      ok: false
      error: string
      steps: AgentStep[]
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
    toolCalls: Array<{ toolName: string; input: unknown }>
    toolResults: Array<{ toolName: string; output: unknown }>
  }>,
): AgentStep[] {
  const events: AgentStep[] = []

  for (const step of steps) {
    if (step.text.trim()) {
      events.push({ type: 'text', summary: step.text.trim() })
    }

    for (const toolCall of step.toolCalls) {
      events.push({
        type: 'tool-call',
        toolName: toolCall.toolName,
        summary: summarizeToolInput(toolCall.toolName, toolCall.input),
      })
    }

    for (const toolResult of step.toolResults) {
      const summary = summarizeToolOutput(toolResult.toolName, toolResult.output)
      const isError =
        !!toolResult.output &&
        typeof toolResult.output === 'object' &&
        ('error' in toolResult.output ||
          ('ok' in toolResult.output && toolResult.output.ok === false))

      events.push({
        type: 'tool-result',
        toolName: toolResult.toolName,
        summary,
        error: isError,
      })
    }
  }

  return events
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
  abortSignal,
  onStepProgress,
  logger,
  versionInspector,
}: RunDeckAgentOptions): Promise<RunDeckAgentResult> {
  const provider = providerInput ?? 'unknown'
  const modelRef = modelRefInput ?? 'unknown'
  throwIfAborted(abortSignal)

  const workspace = createDeckWorkspace(currentHtml)
  const { createDeckTools } = await import('./deck-tools.ts')
  const tools = createDeckTools(workspace, { logger, versionInspector })
  const accumulatedSteps: AgentStep[] = []
  const startedAt = performance.now()

  let result

  try {
    result = await generateText({
      model,
      system: deckAgentSystemPrompt,
      messages: buildAgentModelMessages(messages, currentHtml, editorSelection),
      tools,
      stopWhen: stepCountIs(AGENT_MAX_STEPS),
      maxOutputTokens: 8_000,
      temperature: 0.4,
      abortSignal,
      onStepFinish: async (step) => {
        throwIfAborted(abortSignal)
        accumulatedSteps.push(...extractAgentSteps([step as ExtractableAgentStep]))
        await onStepProgress?.(accumulatedSteps)
      },
    })
  } catch (error) {
    const { categorizeProviderError } = await import('./observability/provider-errors.ts')
    const details = categorizeProviderError(error)

    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Model provider request failed.',
      steps: accumulatedSteps,
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
      : extractAgentSteps(result.steps as ExtractableAgentStep[])
  const assistantText = result.text.trim()

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
    validation: fallback.validation,
    providerMetrics,
  }
}
