import type { LanguageModel } from 'ai'

import type { AgentStep, ChatMessagePart } from '@ark/chat/messages.ts'
import type { ApiChatMessage } from '@ark/chat/api-projection.ts'
import type { EditorSelectionContext, SlideContext } from '@ark/chat/context.ts'
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
import type { Logger } from '@ark/telemetry/logger.ts'
import { createActiveDeckTools } from './tool-catalog.ts'
import {
  buildPromptCacheProviderOptions,
  mergeProviderOptions,
} from '@ark/ai/prompt-cache-options.ts'
import { normalizeProviderTokenUsage } from '@ark/ai/token-usage.ts'
import { buildReasoningProviderOptions } from '@ark/ai/reasoning-options.ts'
import { createThinkingProgressReporter } from './agent-progress.ts'
import { streamDeckAgentRun, throwIfAborted } from './agent-stream.ts'
import { finalizeDeckAgentRun, type RunDeckAgentResult } from './agent-finalize.ts'

export { hasAwaitingUserToolResult } from './agent-stream.ts'
export {
  extractAgentSteps,
  extractAgentTranscriptParts,
  extractThinkingText,
} from './agent-steps.ts'
export type { RunDeckAgentResult }

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
  logger?.info('generation.context.assembled', {
    ...context.metadata,
    ...getAgentGuidesMetadata(),
  })
  const providerOptions = mergeProviderOptions(
    reasoningEffort ? buildReasoningProviderOptions(reasoningEffort, modelRef) : undefined,
    buildPromptCacheProviderOptions({ provider, promptCacheKey }),
  )

  let result
  try {
    result = await streamDeckAgentRun({
      model,
      provider,
      tools,
      modelMessages: context.modelMessages,
      reasoningEffort,
      providerOptions,
      abortSignal,
      accumulatedSteps,
      transcriptParts,
      thinkingProgress,
      activeDefinitions,
      systemPrompt: buildDeckAgentSystemPrompt(),
      onStepProgress,
    })
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

  throwIfAborted(abortSignal)
  return finalizeDeckAgentRun({
    workspaceChanged: workspace.changed,
    workspaceHtml: workspace.html,
    currentHtml,
    resultText: result.text,
    resultSteps: result.steps as never,
    accumulatedSteps,
    transcriptParts,
    activeDefinitions,
    editorSelection,
    editorSelections,
    logger,
    providerMetrics: buildProviderMetrics({
      provider,
      modelRef,
      latencyMs: Math.round(performance.now() - startedAt),
      usage: normalizeProviderTokenUsage(result.totalUsage),
      finishReason: result.finishReason,
    }),
  })
}
