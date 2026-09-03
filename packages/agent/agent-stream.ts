import { hasToolCall, isLoopFinished, streamText, type LanguageModel, type ModelMessage } from 'ai'

import type { AgentStep, ChatMessagePart } from '@ark/chat/messages.ts'
import {
  applyAnthropicConversationCacheBreakpoints,
  buildCachedSystemPrompt,
} from '@ark/ai/prompt-cache-options.ts'
import { createThinkingProgressReporter, type ThinkingProgressReporter } from './agent-progress.ts'
import {
  extractAgentSteps,
  extractAgentTranscriptParts,
  extractThinkingText,
  type ExtractableAgentStep,
} from './agent-steps.ts'
import type { DeckToolDefinition } from './tool-catalog.ts'

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

export function throwIfAborted(abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) {
    throw new DOMException('Generation canceled.', 'AbortError')
  }
}

type DeckAgentStreamTools = Parameters<typeof streamText>[0]['tools']

export type StreamDeckAgentInput = {
  model: LanguageModel
  provider: string
  tools: DeckAgentStreamTools
  modelMessages: ModelMessage[]
  reasoningEffort?: string
  providerOptions?: Parameters<typeof streamText>[0]['providerOptions']
  abortSignal?: AbortSignal
  accumulatedSteps: AgentStep[]
  transcriptParts: ChatMessagePart[]
  thinkingProgress: ThinkingProgressReporter
  activeDefinitions: readonly DeckToolDefinition[]
  systemPrompt: string
}

type StreamTextResult = ReturnType<typeof streamText>

export type StreamDeckAgentOutput = {
  text: string
  steps: Awaited<StreamTextResult['steps']>
  totalUsage: Awaited<StreamTextResult['totalUsage']>
  finishReason: Awaited<StreamTextResult['finishReason']>
}

async function onDeckAgentStepFinish(input: {
  step: ExtractableAgentStep
  abortSignal?: AbortSignal
  accumulatedSteps: AgentStep[]
  transcriptParts: ChatMessagePart[]
  thinkingProgress: ThinkingProgressReporter
  activeDefinitions: readonly DeckToolDefinition[]
  transcriptStepIndex: { value: number }
  onStepProgress?: (steps: AgentStep[]) => void | Promise<void>
}) {
  throwIfAborted(input.abortSignal)
  const thinkingBeforeCount = input.accumulatedSteps.length
  await input.thinkingProgress.commitThinkingStep(extractThinkingText(input.step))
  const committedThinking =
    input.accumulatedSteps.length > thinkingBeforeCount &&
    input.accumulatedSteps[thinkingBeforeCount]?.type === 'thinking'
      ? input.accumulatedSteps[thinkingBeforeCount]
      : null

  const withoutThinking = extractAgentSteps([input.step], input.activeDefinitions).filter(
    (event) => event.type !== 'thinking',
  )
  input.accumulatedSteps.push(...withoutThinking)

  const extracted: ChatMessagePart[] = extractAgentTranscriptParts(
    [input.step as never],
    input.activeDefinitions,
  )
    .filter((part) => part.type !== 'thinking')
    .map((part) => ({ ...part, stepIndex: input.transcriptStepIndex.value }))
  if (committedThinking) {
    extracted.unshift({
      type: 'thinking',
      content: committedThinking.summary,
      stepIndex: input.transcriptStepIndex.value,
      ...(committedThinking.durationMs !== undefined
        ? { durationMs: committedThinking.durationMs }
        : {}),
    })
  }
  input.transcriptParts.push(...extracted)
  input.transcriptStepIndex.value += 1
  await input.onStepProgress?.(input.accumulatedSteps)
}

export async function streamDeckAgentRun(
  input: StreamDeckAgentInput & {
    onStepProgress?: (steps: AgentStep[]) => void | Promise<void>
  },
): Promise<StreamDeckAgentOutput> {
  const transcriptStepIndex = { value: 0 }
  let streamError: unknown
  const stream = streamText({
    model: input.model,
    system: buildCachedSystemPrompt(input.provider, input.systemPrompt),
    messages: input.modelMessages,
    tools: input.tools,
    stopWhen: [
      hasToolCall('ask_user'),
      hasAwaitingUserToolResult('propose_themes'),
      isLoopFinished(),
    ],
    ...(input.provider === 'anthropic'
      ? {
          prepareStep: ({ messages }) => ({
            messages: applyAnthropicConversationCacheBreakpoints(messages),
          }),
        }
      : {}),
    ...(input.reasoningEffort || input.provider === 'google' ? {} : { temperature: 0.4 }),
    ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    abortSignal: input.abortSignal,
    onError: ({ error }) => {
      streamError ??= error
    },
    onChunk: async ({ chunk }) => {
      throwIfAborted(input.abortSignal)
      if (chunk.type === 'reasoning-delta') {
        input.thinkingProgress.appendDelta(chunk.text)
      }
    },
    onStepFinish: async (step) => {
      await onDeckAgentStepFinish({
        step: step as ExtractableAgentStep,
        abortSignal: input.abortSignal,
        accumulatedSteps: input.accumulatedSteps,
        transcriptParts: input.transcriptParts,
        thinkingProgress: input.thinkingProgress,
        activeDefinitions: input.activeDefinitions,
        transcriptStepIndex,
        onStepProgress: input.onStepProgress,
      })
    },
  })

  await stream.consumeStream()
  if (streamError) {
    throw streamError
  }
  const result = {
    text: await stream.text,
    steps: await stream.steps,
    totalUsage: await stream.totalUsage,
    finishReason: await stream.finishReason,
  }
  const trailingThinkingBefore = input.accumulatedSteps.length
  await input.thinkingProgress.commitThinkingStep()
  if (
    input.accumulatedSteps.length > trailingThinkingBefore &&
    input.accumulatedSteps[trailingThinkingBefore]?.type === 'thinking'
  ) {
    const trailingThinking = input.accumulatedSteps[trailingThinkingBefore]
    input.transcriptParts.push({
      type: 'thinking',
      content: trailingThinking.summary,
      stepIndex: transcriptStepIndex.value,
      ...(trailingThinking.durationMs !== undefined
        ? { durationMs: trailingThinking.durationMs }
        : {}),
    })
  }
  return result
}

export { createThinkingProgressReporter }
